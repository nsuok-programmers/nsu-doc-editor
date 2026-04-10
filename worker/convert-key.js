const fs = require("fs");
const crypto = require("crypto");

const pkcs1 = fs.readFileSync("./nsu-docs-editor-private-key.pem", "utf-8");
const privateKey = crypto.createPrivateKey(pkcs1);

const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" });
fs.writeFileSync("./nsu-docs-editor-private-key-pkcs8.pem", pkcs8);
console.log("Converted private key to PKCS#8 format and saved to ./nsu-docs-editor-private-key-pkcs8.pem");
