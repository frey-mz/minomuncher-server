import { downloadReplay, ioAuth } from "./io";
import { RateLimitedPromiseQueue } from "./promiseQueue";
import { parseReplay } from "./replayParser/parser";
import { RateLimiterMemory } from "rate-limiter-flexible";

const rateLimiter = new RateLimiterMemory({
  points: 10, // 6 points
  duration: 3, // Per second
});

//use a bot account
const token = await ioAuth(Bun.env.TETRIO_USERNAME, Bun.env.TETRIO_PASSWORD);
const queryQueue = new RateLimitedPromiseQueue(1000);

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // x-forwarded-for may contain multiple IPs, the first one is the real client
    return forwardedFor.split(",")[0].trim();
  }

  const conn = (req as any).conn; // Bun exposes a `conn` property
  if (conn && conn.remoteAddress) {
    return conn.remoteAddress;
  }

  return `${Math.random()}`
}

const server = Bun.serve({
  port: 3000,
  routes: {
    "/status": new Response("OK"),
    "/replay/:id": async (req) => {
      try {
        await rateLimiter.consume(getClientIp(req), 1);
      } catch (e) {
        return Response.json({ message: "rate limted" }, { status: 400 });
      }
      const id = req.params.id;
      let rep: string;
      try {
        rep = await queryQueue.enqueue(() => downloadReplay(id, token));
      } catch (e) {
        return Response.json(
          { message: "error downloading replay" },
          { status: 400 }
        );
      }
      try {
        const stats = parseReplay(rep);
        if (stats === undefined) throw Error();
        return Response.json(stats, { status: 200 });
      } catch (e) {
        return Response.json({ message: "error parsing" }, { status: 400 });
      }
    },
    "/replay": {
      GET: (_req) => {
        return Response.json(
          { message: "You need to make a post request to this endpoint" },
          { status: 400 }
        );
      },
      POST: async (req) => {
        try {
          await rateLimiter.consume(getClientIp(req), 1);
        } catch (e) {
          return Response.json({ message: "rate limted" }, { status: 400 });
        }
        try {
          const stats = parseReplay(await req.text());
          if (stats === undefined) throw Error();
          return Response.json(stats, { status: 200 });
        } catch (e) {
          return Response.json({ message: "error parsing" }, { status: 400 });
        }
      },
    },
    "/league/:id": async (req) => {
      try {
        await rateLimiter.consume(getClientIp(req), 1);
      } catch (e) {
        return Response.json({ message: "rate limted" }, { status: 400 });
      }
      const apiUrl = `https://ch.tetr.io/api/users/${req.params.id}/records/league/recent`;
      return queryPass(apiUrl);
    },
    "/user/:username": async (req) => {
      try {
        await rateLimiter.consume(getClientIp(req), 1);
      } catch (e) {
        return Response.json({ message: "rate limted" }, { status: 400 });
      }
      const apiUrl = `https://ch.tetr.io/api/users/${req.params.username}`;
      return queryPass(apiUrl);
    },
    // Wildcard route for all routes that start with "/api/" and aren't otherwise matched
    "/api/*": Response.json({ message: "Not found" }, { status: 404 }),
  },
});

async function queryPass(apiUrl: string) {
  try {
    const res = await fetch(apiUrl);

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch from TETR.IO" }),
        { status: res.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

console.log(`Listening on http://localhost:${server.port}`);
