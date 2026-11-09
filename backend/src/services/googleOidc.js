import { OAuth2Client } from "google-auth-library";
import { config } from "../config/index.js";

export function createGoogleOidc({ clientId, clientSecret, redirectUri } = config.google) {
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri });
  return {
    enabled: Boolean(clientId && clientSecret),
    authorizationUrl({ state, nonce, codeChallenge }) {
      return client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        state,
        nonce,
        prompt: "select_account",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        hd: config.allowedEmailDomains[0],
      });
    },
    async exchange({ code, codeVerifier, nonce }) {
      const { tokens } = await client.getToken({ code, codeVerifier });
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      const payload = ticket.getPayload();
      if (payload.nonce !== nonce) throw new Error("nonce mismatch");
      return { sub: payload.sub, email: payload.email, email_verified: payload.email_verified, hd: payload.hd, name: payload.name };
    },
  };
}
