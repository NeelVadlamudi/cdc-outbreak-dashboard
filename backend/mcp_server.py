"""MCP server exposing the read-only data tools.

Run with: python -m backend.mcp_server   (stdio transport)
"""

from mcp.server.fastmcp import FastMCP

from backend.agent import tools as data_tools

mcp = FastMCP("cdc-outbreak-data")

for _name, (_fn, _schema) in data_tools.TOOLS.items():
    mcp.tool(name=_name, description=_fn.__doc__)(_fn)


if __name__ == "__main__":
    mcp.run()
