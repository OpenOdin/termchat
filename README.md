# OpenOdin terminal-based chat application

This is the official OpenOdin terminal-based chat application (termchat).

## Build
```sh
npm i
npm run tsc
```

## Configure
1. Set the `jumpPeerPublicKey` entries in the app.json configuration file to match the server address;
2. Set the `serverPublicKey` entry in the app.json configuration file to match the server address;
3. Provide a keyfile.json configuration file to serve as input to wallet.json.

## Run
```
node build/index.js app.json wallet.json
```
