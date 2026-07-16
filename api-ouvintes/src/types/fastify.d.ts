import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: "admin" | "viewer";
      name: string;
      username: string;
    };
    user: {
      sub: string;
      role: "admin" | "viewer";
      name: string;
      username: string;
    };
  }
}
