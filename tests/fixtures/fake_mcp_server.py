"""A tiny MCP server over stdio for the bridge's tests: one read-only tool and one that fails."""
from mcp.server.mcpserver import MCPServer as FastMCP

app = FastMCP("fake-analytics")


@app.tool()
def run_report(metric: str = "sessions") -> str:
    """Return a fixed report."""
    return f"{metric}: 1234 in the last 7 days"


@app.tool()
def broken() -> str:
    """Always fails."""
    raise RuntimeError("no property access")


if __name__ == "__main__":
    app.run()
