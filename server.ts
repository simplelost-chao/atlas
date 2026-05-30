import { createServer } from "http";
import next from "next";
import { parse } from "url";
import { createHocuspocusServer } from "./src/server/collab/hocuspocus";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  const hocuspocusServer = createHocuspocusServer();

  await app.prepare();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Handle WebSocket upgrades
  server.on("upgrade", async (req, socket, head) => {
    const { pathname } = parse(req.url!, true);

    if (pathname === "/collab") {
      // Use the hocuspocus crossws adapter to handle the upgrade
      const crossws = (hocuspocusServer as any).crossws;
      if (crossws) {
        await crossws.handleUpgrade(req, socket, head);
      } else {
        socket.destroy();
      }
    } else {
      // Let Next.js handle other WebSocket connections (HMR, etc.)
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Hocuspocus WebSocket on ws://${hostname}:${port}/collab`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
