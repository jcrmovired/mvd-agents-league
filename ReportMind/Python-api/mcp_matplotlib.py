#!/usr/bin/env python3
import json
import sys
import asyncio
import matplotlib.pyplot as plt
import matplotlib
import io
import base64

matplotlib.use('Agg')

class MatplotlibMCPServer:
    def __init__(self):
        self.tools = [
            {
                "name": "create_chart",
                "description": "Create charts using matplotlib",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "chart_type": {
                            "type": "string",
                            "enum": ["line", "bar", "scatter", "histogram", "pie"],
                            "description": "Type of chart"
                        },
                        "data": {
                            "type": "object",
                            "description": "Chart data in any format"
                        },
                        "title": {"type": "string"},
                        "xlabel": {"type": "string"},
                        "ylabel": {"type": "string"}
                    },
                    "required": ["chart_type", "data"]
                }
            }
        ]

    def normalize_data(self, args):
        """Normalizes any data format the LLM might send into x/y or datasets format."""
        data = args.get('data', {})

        # Normalize chart_type from any variant
        if 'chart_type' not in args:
            args['chart_type'] = args.get('chartType') or args.get('type') or 'line'

        # Normalize axis labels from any variant
        xlabel = args.get('xAxisLabel') or args.get('xlabel') or (args.get('xAxis') or {}).get('label', 'X')
        ylabel = args.get('yAxisLabel') or args.get('ylabel') or (args.get('yAxis') or {}).get('label', 'Y')

        # Format: {data: [{label, value}]} — flat array of objects
        if isinstance(data, list) and len(data) > 0 and 'label' in data[0]:
            labels = [d.get('label', '') for d in data]
            values = [d.get('value', d.get('y', 0)) for d in data]
            return {'labels': labels, 'datasets': [{'name': '', 'data': values}]}, xlabel, ylabel

        # Format: {series, xAxis} at root level
        if 'series' in args and 'xAxis' in args:
            categories = (args.get('xAxis') or {}).get('categories', [])
            series = args.get('series', [])
            return {'labels': categories, 'datasets': series}, xlabel, ylabel

        # Format: {data: {series, xAxis}} — nested
        if isinstance(data, dict) and ('series' in data or 'xAxis' in data):
            categories = (data.get('xAxis') or {}).get('categories', [])
            series = data.get('series', [])
            return {'labels': categories, 'datasets': series}, xlabel, ylabel

        # Format: {data: {labels, datasets}}
        if isinstance(data, dict) and 'datasets' in data and 'labels' in data:
            return data, xlabel, ylabel

        # Format: {data: {x, y}}
        if isinstance(data, dict) and ('x' in data or 'y' in data):
            return data, xlabel, ylabel

        # Format: {data: {values}} for pie/histogram
        if isinstance(data, dict) and 'values' in data:
            return data, xlabel, ylabel

        return data, xlabel, ylabel

    async def create_chart(self, args):
        try:
            # Normalize chart_type (LLM may send 'type' or 'chartType')
            if 'chart_type' not in args:
                args['chart_type'] = args.get('chartType') or args.get('type') or 'line'
            chart_type = args.get('chart_type', 'line')
            title = args.get('title', 'Chart')
            data, xlabel, ylabel = self.normalize_data(args)
            plt.figure(figsize=(12, 6))

            if 'datasets' in data and 'labels' in data:
                labels = data['labels']
                datasets = data['datasets']
                x = range(len(labels))

                for i, dataset in enumerate(datasets):
                    name = dataset.get('name') or dataset.get('label') or ''
                    values = dataset.get('data') or dataset.get('values') or []

                    if chart_type == 'line':
                        plt.plot(labels, values, marker='o', label=name)
                    elif chart_type == 'bar':
                        width = 0.8 / len(datasets)
                        offset = (i - len(datasets) / 2) * width + width / 2
                        plt.bar([p + offset for p in x], values, width, label=name)

                if chart_type == 'bar':
                    plt.xticks(list(x), labels, rotation=45, ha='right')
                else:
                    plt.xticks(rotation=45, ha='right')
                plt.legend()

            elif 'x' in data and 'y' in data:
                if chart_type == 'line':
                    plt.plot(data['x'], data['y'], marker='o')
                elif chart_type == 'bar':
                    plt.bar(data['x'], data['y'])
                elif chart_type == 'scatter':
                    plt.scatter(data['x'], data['y'])

            elif 'values' in data:
                if chart_type == 'histogram':
                    plt.hist(data['values'], bins=data.get('bins', 10))
                elif chart_type == 'pie':
                    plt.pie(data['values'], labels=data.get('labels', []), autopct='%1.1f%%')

            plt.title(title)
            if chart_type != 'pie':
                plt.xlabel(xlabel)
                plt.ylabel(ylabel)
                plt.grid(True, alpha=0.3)

            plt.tight_layout()

            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=72, bbox_inches='tight')
            buf.seek(0)
            image_b64 = base64.b64encode(buf.getvalue()).decode()
            plt.close()

            # Compress if still too large (>180KB base64 ~ 135KB binary)
            if len(image_b64) > 180000:
                buf2 = io.BytesIO()
                from PIL import Image
                img = Image.open(io.BytesIO(base64.b64decode(image_b64)))
                img = img.resize((int(img.width * 0.6), int(img.height * 0.6)), Image.LANCZOS)
                img.save(buf2, format='PNG', optimize=True)
                buf2.seek(0)
                image_b64 = base64.b64encode(buf2.getvalue()).decode()

            return {
                "content": [
                    {"type": "text", "text": f"Chart created: {title}"},
                    {"type": "image", "data": image_b64, "mimeType": "image/png"}
                ]
            }

        except Exception as e:
            return {"content": [{"type": "text", "text": f"Error: {str(e)}"}]}

    async def handle_request(self, request):
        method = request.get("method")
        if method == "tools/list":
            return {"tools": self.tools}
        elif method == "tools/call":
            params = request.get("params", {})
            if params.get("name") == "create_chart":
                return await self.create_chart(params.get("arguments", {}))
        return {"error": "Unknown method"}

async def main():
    server = MatplotlibMCPServer()
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            request = json.loads(line.strip())
            response = await server.handle_request(request)
            print(json.dumps(response))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.stdout.flush()

if __name__ == "__main__":
    asyncio.run(main())
