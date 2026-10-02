import { randomUUID } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { OperatorIdentity, OperatorRole } from "@aeroguard/shared";

declare global {
  namespace Express {
    interface Request {
      operator?: OperatorIdentity;
    }
  }
}

function jwtSecret() {
  const configured = process.env.AEROGUARD_JWT_SECRET;
  if (process.env.NODE_ENV === "production" && !configured)
    throw new Error("AEROGUARD_JWT_SECRET must be configured in production");
  return configured || "local-only-aeroguard-demo-secret-change-me";
}
type TokenClaims = JwtPayload & {
  sub: string;
  email: string;
  name: string;
  role: OperatorRole;
  purpose: "access" | "websocket";
};

export function issueAccessToken(identity: OperatorIdentity) {
  return jwt.sign(
    { ...identity, purpose: "access" },
    jwtSecret(),
    { subject: identity.id, expiresIn: "8h" },
  );
}

export function issueWebSocketTicket(identity: OperatorIdentity) {
  return jwt.sign(
    { ...identity, purpose: "websocket", jti: randomUUID() },
    jwtSecret(),
    { subject: identity.id, expiresIn: "30s" },
  );
}

function verifyToken(token: string, purpose: TokenClaims["purpose"]) {
  const payload = jwt.verify(token, jwtSecret()) as TokenClaims;
  if (payload.purpose !== purpose) throw new Error("Wrong token purpose");
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    role: payload.role,
  } satisfies OperatorIdentity;
}

export function verifyWebSocketTicket(ticket: string) {
  return verifyToken(ticket, "websocket");
}

export const requireAuth: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const authorization = request.header("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  const sessionToken = scheme === "Bearer" && token
    ? token
    : request.cookies?.aeroguard_session;
  if (!sessionToken) {
    response.status(401).json({ error: "Sign in required" });
    return;
  }
  try {
    request.operator = verifyToken(sessionToken, "access");
    next();
  } catch {
    response.status(401).json({ error: "Session expired or invalid" });
  }
};

export function requireRoles(...roles: OperatorRole[]): RequestHandler {
  return (request, response, next) => {
    if (!request.operator) {
      response.status(401).json({ error: "Sign in required" });
      return;
    }
    if (!roles.includes(request.operator.role)) {
      response.status(403).json({ error: "Insufficient role" });
      return;
    }
    next();
  };
}