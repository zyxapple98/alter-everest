import { createHash, generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
const publicDer = publicKey.export({ format: "der", type: "spki" });

console.log(
  JSON.stringify(
    {
      keyId: createHash("sha256").update(publicDer).digest("hex").slice(0, 24),
      privateKeySecretName: "VERIFIER_PRIVATE_KEY_PKCS8_BASE64",
      privateKeyPkcs8Base64: privateDer.toString("base64"),
      publicKeyVariableName: "VERIFIER_PUBLIC_KEY_SPKI_BASE64",
      publicKeySpkiBase64: publicDer.toString("base64"),
    },
    null,
    2,
  ),
);
