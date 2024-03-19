import { strict as assert } from "assert";

import Readline from "readline";

import {
    Service,
    ParseUtil,
    JSONUtil,
    WalletConf,
    ApplicationConf,
    SignatureOffloader,
    AuthFactory,
    CRDTViewItem,
} from "openodin";

import {
    PocketConsole,
} from "pocket-console";

import {
    MessageController,
    Message,
} from "./MessageController";

import {
    ChannelListController,
    Channel,
} from "./ChannelListController";

import {
    PresenceController,
} from "./PresenceController";

let console = PocketConsole({module: "TermChat", format: "%c[%L%l]%C "});

export class TermChat {
    protected presenceController?: PresenceController;

    protected channelListController?: ChannelListController;

    constructor(protected service: Service) {
        service.onStorageConnect( () => {
            console.info("Connected to storage");

            this.presenceController = new PresenceController({}, service);

            this.presenceController.activityDetected();

            this.channelListController = new ChannelListController({}, service);
        });

        service.onPeerConnect( (p2pClient) => {
            const pubKey = p2pClient.getRemotePublicKey();
            console.info(`Peer connected: ${pubKey.toString("hex")}`);

            p2pClient.onMessagingError( (message) => {
                console.error("Error in peer", message);
            });

            p2pClient.onMessagingPong( (roundTripTime) => {
                // TODO: show this round trip value in the UI instead of in the console.
            });
        });

        service.onPeerFactoryCreate( (handshakeFactory) => {
            handshakeFactory.onSocketFactoryError( (name, error) => {
                console.error("Socket error", name, error.message);
            });

            handshakeFactory.onHandshakeError( (error) => {
                console.error("Handshake error", error.message);
            });
        });

        service.onPeerClose( (p2pClient) => {
            const pubKey = p2pClient.getRemotePublicKey();
            console.info(`Peer disconnected: ${pubKey.toString("hex")}`);
        });

        this.setupUI();
    }

    protected setupUI() {
        const readline = Readline.createInterface({input: process.stdin, output: process.stderr});

        readline.on("line", (input: string) => {
            Readline.moveCursor(process.stderr, 0, -1);  // Delete our input

            if (input[0] === '/') {
                this.handleCommand(input);
            }
            else {
                this.sendChat(input);
            }
        });

        // This hook will quit the chat on ctrl-c and ctrl-d.
        readline.on("close", () => this.service.stop() );

        console.info("Type /help for list of commands");
    }

    protected async sendChat(message: string) {
        assert(this.channelListController);

        const controller = this.channelListController.getActiveController();

        if (!controller) {
            console.error("No channel opened");

            return;
        }

        controller.sendMessage(message);
    }

    protected showHelp() {
        console.log(`The following commands are available:
/help (shows this help)
/presence (list all active and inactive public keys)
/channels (list all channels available)
/q <publicKey index> (create a new private channel targeted at given public key by its index in /presence list)
/open <channel index> (open and activate a channel for messaging based on its index in the /channels list)`);
    }

    protected async handleCommand(command: string) {
        if (command === "/help") {
            this.showHelp();
        }
        else if (command === "/presence") {
            const activeList = this.presenceController?.getActiveList() ?? [];
            const inactiveList = this.presenceController?.getInactiveList() ?? [];

            const all = [...activeList, ...inactiveList];

            all.forEach( (publicKey: Buffer, index: number) => {
                const active = index < activeList.length;

                const you = publicKey.equals(this.service.getPublicKey()) ? " (this is you)" : "";

                if (active) {
                    console.log(`${index} (active) ${publicKey.toString("hex")}${you}`);
                }
                else {
                    console.log(`${index} (inactive) ${publicKey.toString("hex")}${you}`);
                }
            });
        }
        else if (command === "/channels") {
            console.log("Channels:");

            const channels = this.channelListController?.getItems() ?? [];

            channels.forEach( (item: CRDTViewItem, index: number) => {
                const channel = item.data as Channel;

                console.log(`${index} ${channel.name}, isOpen: ${channel.controller !== undefined}, isPrivate: ${channel.isPrivate}`);
            });
        }
        else if (command.startsWith("/q ")) {
            const index = parseInt(command.slice(3));

            const activeList = this.presenceController?.getActiveList() ?? [];
            const inactiveList = this.presenceController?.getInactiveList() ?? [];

            const all = [...activeList, ...inactiveList];

            const publicKey = all[index];

            console.info(`Creating private channel with ${publicKey.toString("hex")}`);

            assert(this.channelListController);

            const channelNode = await this.channelListController.makePrivateChannel(publicKey);

            console.info("Channel created", channelNode.toString());
        }
        else if (command.startsWith("/open ")) {
            const index = parseInt(command.slice(6));

            assert(this.channelListController);

            this.channelListController.getActiveController()?.close();

            const channels = this.channelListController.getItems().map( item => item.id1 );

            const channelId1 = channels[index];

            console.info(`Open channel with ${channelId1.toString("hex")}`);

            assert(this.channelListController);

            const controller = await this.channelListController.openChannel(channelId1);

            this.channelListController.setChannelActive(channelId1);

            controller.onChange( () => this.redraw(controller) );
        }
        else {
            console.error(`Unknown command: ${command}`);
        }
    }

    protected redraw(controller: MessageController) {
        console.info("Redraw");

        controller.getItems().forEach( (item: CRDTViewItem) => {
            const message = item.data as Message;

            console.log(`${message.creationTimestamp} ${message.publicKey}: ${message.text}`);
        });
    }
}

async function main(applicationConf: ApplicationConf, walletConf: WalletConf) {
    console.info("Initializing...");

    const keyPair = walletConf.keyPairs[0];

    assert(keyPair, "expecting keyPair in walletconf");

    const handshakeFactoryFactory = new AuthFactory(keyPair);

    const signatureOffloader = new SignatureOffloader();

    await signatureOffloader.init();

    const service = new Service(applicationConf, walletConf, signatureOffloader,
        handshakeFactoryFactory);

    await service.init()

    const termChat = new TermChat(service);

    service.onStop( () => {
        signatureOffloader.close();
    });

    try {
        await service.start();
    }
    catch(e) {
        signatureOffloader.close();
        console.error("Could not init Service", e);
        process.exit(1);
    }
}

if (process.argv.length < 4) {
    console.getConsole().error(`Usage: TermChat.ts application.json wallet.json`);
    process.exit(1);
}

const applicationConfigPath = process.argv[2];
const walletConfigPath = process.argv[3];

if (typeof(applicationConfigPath) !== "string" || typeof(walletConfigPath) !== "string") {
    console.getConsole().error(`Usage: TermChat.ts application.json wallet.json`);
    process.exit(1);
}

let applicationConf: ApplicationConf;
let walletConf: WalletConf;

try {
    applicationConf = ParseUtil.ParseApplicationConf(
        JSONUtil.LoadJSON(applicationConfigPath, ['.']));

    walletConf = ParseUtil.ParseWalletConf(
        JSONUtil.LoadJSON(walletConfigPath, ['.']));
}
catch(e) {
    console.error("Could not parse config files", (e as any as Error).message);
    process.exit(1);
}

main(applicationConf, walletConf);
