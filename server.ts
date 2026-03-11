const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(path: string): string {
  for (const [suffix, type] of Object.entries(MIME_TYPES)) {
    if (path.endsWith(suffix)) {
      return type;
    }
  }
  return "application/octet-stream";
}

function resolvePath(pathname: string): string {
  if (pathname === "/" || pathname === "") {
    return "./index.html";
  }
  const normalized = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return `./${normalized}`;
}

Deno.serve({ port: 8000 }, async (request) => {
  const url = new URL(request.url);
  const path = resolvePath(url.pathname);

  try {
    const file = await Deno.readFile(path);
    return new Response(file, {
      headers: {
        "content-type": contentType(path),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(String(error), { status: 500 });
  }
});

console.log("Serving boltzmann2 at http://localhost:8000");
