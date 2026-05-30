import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { db } from "../db";
import { initializeYjsDocument } from "./yjs-schema";

/**
 * Create the Hocuspocus Server instance with database persistence.
 *
 * Document names follow the pattern: "chain:<chainId>"
 */
export function createHocuspocusServer() {
  return new Server({
    extensions: [
      new Database({
        /**
         * Load document state from PostgreSQL.
         */
        fetch: async ({ documentName }) => {
          const chainId = extractChainId(documentName);
          if (!chainId) return null;

          const doc = await db.collabDocument.findUnique({
            where: { chainId },
          });

          return doc?.state ? Buffer.from(doc.state) : null;
        },

        /**
         * Persist document state to PostgreSQL on every change.
         */
        store: async ({ documentName, state }) => {
          const chainId = extractChainId(documentName);
          if (!chainId) return;

          await db.collabDocument.upsert({
            where: { chainId },
            create: {
              chainId,
              state: Buffer.from(state),
            },
            update: {
              state: Buffer.from(state),
            },
          });
        },
      }),
    ],

    /**
     * Authenticate the WebSocket connection.
     * The token is passed as a query parameter from the client.
     */
    async onAuthenticate({ token, documentName }) {
      if (!token) {
        throw new Error("Authentication required");
      }

      // Validate the token (session token from NextAuth)
      const session = await db.session.findUnique({
        where: { sessionToken: token },
        include: { user: true },
      });

      if (!session || session.expires < new Date()) {
        throw new Error("Invalid or expired session");
      }

      // Verify user has access to the chain's team
      const chainId = extractChainId(documentName);
      if (!chainId) throw new Error("Invalid document name");

      const chain = await db.industryChain.findUnique({
        where: { id: chainId },
        include: { project: true },
      });

      if (!chain) throw new Error("Chain not found");

      const member = await db.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: chain.project.teamId,
            userId: session.userId,
          },
        },
      });

      if (!member) throw new Error("Access denied");

      return {
        user: {
          id: session.userId,
          name: session.user.name,
          email: session.user.email,
          role: member.role,
        },
      };
    },

    /**
     * Initialize a new document with the chain data from the database.
     */
    async onLoadDocument({ document, documentName }) {
      const chainId = extractChainId(documentName);
      if (!chainId) return;

      // Only initialize if the document is empty
      const chainNodes = document.getMap("chainNodes");
      if (chainNodes.size === 0) {
        await initializeYjsDocument(document, chainId, db);
      }
    },
  });
}

function extractChainId(documentName: string): string | null {
  const match = documentName.match(/^chain:(.+)$/);
  return match ? match[1] : null;
}
