import { strict as assert } from "assert";

import termkit from "terminal-kit";

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
    public chat: any;
    protected presenceController?: PresenceController;

    protected channelListController?: ChannelListController;

    protected lastRenderedItemId1?: Buffer;


    constructor(protected service: Service) {
        service.onStorageConnect( () => {
            this.chat.appendLog(`^!Connected to storage`);

            const presenceTemplate = service.getThreadTemplates().presence;

            this.presenceController = new PresenceController(service, presenceTemplate);

            this.presenceController.activityDetected();

            const channelListTemplate = service.getThreadTemplates().channels;

            const messageTemplate = service.getThreadTemplates().channel;

            this.channelListController = new ChannelListController(service, channelListTemplate,
                messageTemplate);
        });

        service.onPeerConnect( (p2pClient) => {
            const pubKey = p2pClient.getRemotePublicKey();
            this.chat.appendLog(`^!Peer connected: ${pubKey.toString("hex")}`);

            p2pClient.onMessagingError( (message) => {
                this.chat.appendLog(`^!Error in peer: ${message}`);
            });

            p2pClient.onMessagingPong( (roundTripTime) => {
                // TODO: show this round trip value in the UI instead of in the console.
            });
        });

        service.onPeerFactoryCreate( (handshakeFactory) => {
            handshakeFactory.onSocketFactoryError( (name, error) => {
                this.chat.appendLog(`^!Socket error: ${name}. Message: ${error.message}`);
            });

            handshakeFactory.onHandshakeError( (error) => {
                this.chat.appendLog(`^!Handshake error: ${error.message}`);
            });
        });

        service.onPeerClose( (p2pClient) => {
            const pubKey = p2pClient.getRemotePublicKey();
            this.chat.appendLog(`^!Peer disconnected: ${pubKey.toString("hex")}`);
        });

        this.setupUI();
    }

    protected setupUI() {
        const term = termkit.terminal;

        // xterm-compatible window title
        term.windowTitle("termchat");

        // NOTE: remove mouse events to prevent unhandled clipboard bugs (socket pipe error)
        /*
        term.grabInput({
            mouse: false,
            focus: true
        });*/
        term.mouseDrag(false);
        term.mouseMotion(false);

        //@ts-ignore: @types/terminal-kit 2.5.0 is not in sync with latest terminal-kit version 3
        var document = term.createDocument( {
            backgroundAttr: {
                // NOTE: consider using magenta when debugging
                //bgColor: "magenta",
                //dim: true
            },
        } ) ;

        let thisReference = this;
        let history: string[] = [];
        let layout: any;
        let chatInputBackground: any;
        const draw = function() {
            // Hide existing layout
            if (layout) {
                layout.hide();
            }

            //@ts-ignore: @types/terminal-kit 2.5.0 is not in sync with latest terminal-kit version 3
            layout = new termkit.Layout( {
                parent: document ,
                boxChars: "double",
                zIndex: 10,
                movable: false,
                layout: {
                    id: "main",
                    y: 0 ,
                    widthPercent: 100,
                    height: (term.height - 3),
                    rows: [
                        {
                            id: "1st row",
                            heightPercent: 100,
                            columns: [
                                {
                                    id: "chat"
                                },
                            ]
                        }
                    ]
                }
            } ) ;

            //@ts-ignore: @types/terminal-kit 2.5.0 is not in sync with latest terminal-kit version 3
            thisReference.chat = new termkit.TextBox({
                parent: document,
                zIndex: 1,
                content: thisReference.chat ? thisReference.chat.getContent() : `^!Welcome to termchat!
^!Type /help for list of commands.`,
                attr: {
                    bgColor: "default"
                },
                hidden: false,
                x: 1,
                y: 1,
                width: (term.width - 2),
                height: (term.height - 5),
                scrollable: true,
                vScrollBar: true,
                lineWrap: false,
                wordWrap: true,
                movable: false,
                contentHasMarkup: true,

                // Remove all preset keybindings (includes scroll and copyToDocument/ToSystemClipboard
                keyBindings: {
                }
            });

            //@ts-ignore: @types/terminal-kit 2.5.0 is not in sync with latest terminal-kit version 3
            let say = new termkit.TextBox({
                parent: document,
                zIndex: 1,
                content: " Say: ",
                // NOTE: consider using magenta when debugging
                //attr: { bgColor: "magenta" },
                hidden: false,
                x: 1,
                y: (term.height - 4),
                width: 6,
                height: 1,
                scrollable: false,
                vScrollBar: false,
                lineWrap: false,
                wordWrap: true,
                movable: false,
                contentHasMarkup: true
            } ) ;


            //@ts-ignore: @types/terminal-kit 2.5.0 is not in sync with latest terminal-kit version 3
            chatInputBackground = new termkit.TextBox({
                parent: document,
                zIndex: 1,
                content: "> ",
                attr: {
                    bgColor: "default"
                },
                hidden: false,
                x: 0,
                y: (term.height - 3),
                width: term.width,
                height: term.height,
                scrollable: false,
                vScrollBar: false,
                lineWrap: false,
                wordWrap: true,
                movable: false,
                contentHasMarkup: true
            });


            thisReference.chat.onClick = function() {
            };

        };

        draw();

        let inputFieldEventEmitter: any;
        const createInputField = function() {
            inputFieldEventEmitter = term.inputField( {
                default: "",
                //@ts-ignore: @types/terminal-kit 2.5.0 is not in sync with latest terminal-kit version 3
                x: 3,
                y: (term.height - 2),
                cancelable: false,
                history: history,
                autoCompleteHint: true,
                maxLength: (term.width * 3 - 3)
            }, function(error: any, msg: string) {
                if (msg) {
                    if (msg[0] === '/') {
                        thisReference.handleCommand(msg);
                    } else {
                        // Send
                        thisReference.sendChat(msg);
                    }

                    // Update UI
                    history.push(msg);
                    term.saveCursor();
                    createInputField();
                    term.moveTo(1, term.height);

                    // Toggle elements to emulate a redraw since redraw doesn't appear to work
                    // Only do that when the message spans multiple lines
                    if (msg.length > term.width) {
                        document.redraw(true);
                        layout.redraw(true);
                        thisReference.chat.draw();

                        thisReference.chat.hide();
                        thisReference.chat.show();
                        document.hide();
                        document.show();

                        chatInputBackground.hide();
                        chatInputBackground.show();

                        layout.hide();
                        layout.show();
                    }
                }
            });
        }
        createInputField();

        term.on("resize", function(width: number, height: number) {
            chatInputBackground.hide();
            chatInputBackground.show();
            draw();
            chatInputBackground.hide();
            chatInputBackground.show();
            thisReference.chat.scrollToBottom();
            inputFieldEventEmitter.rebase(3, height - 2);
        });

        term.on("key" , function(name: string, matches: any, data: any) {
            if (name === "CTRL_C") {
                thisReference.service.stop();

                term.grabInput( false ) ;
                term.hideCursor( false ) ;
                term.styleReset() ;
                term.clear() ;

                process.exit() ;
            } else if (name == "PAGE_UP" || name == "SHIFT_PAGE_UP") {
                thisReference.chat.scroll(0, 1);
            } else if (name == "PAGE_DOWN" || name == "SHIFT_PAGE_DOWN") {
                thisReference.chat.scroll(0, -1);
            }
        });

        term.on("mouse", function(name: string, data: any) {
            term.move(0, 0);
        });

        term.on("error" , function(err: any) {
            console.error(err);
        });
    }

    protected async sendChat(message: string) {
        assert(this.channelListController);

        this.presenceController?.activityDetected();

        const controller = this.channelListController.getActiveController();

        if (!controller) {
            this.chat.appendLog(`^!No channel opened`);

            return;
        }

        controller.sendMessage(message);
    }

    protected showHelp() {
        this.chat.appendLog(`^!The following commands are available:
^!/help (shows this help)
^!/presence (list all active and inactive public keys)
^!/channels (list all channels available)
^!/q <publicKey index> (create a new private channel targeted at given public key by its index in /presence list)
^!/open <channel index> (open and activate a channel for messaging based on its index in the /channels list)`);
    }

    protected async handleCommand(command: string) {
        if (command.startsWith("/help")) {
            this.showHelp();
        }
        else if (command.startsWith("/presence")) {
            this.chat.appendLog(`^!Presence list:`);
            const activeList = this.presenceController?.getActiveList() ?? [];
            const inactiveList = this.presenceController?.getInactiveList() ?? [];

            const all = [...activeList, ...inactiveList];

            all.forEach( (publicKey: Buffer, index: number) => {
                const active = index < activeList.length;

                const you = publicKey.equals(this.service.getPublicKey()) ? " (this is you)" : "";

                if (active) {
                    this.chat.appendLog(`^!${index} (active) ${publicKey.toString("hex")}${you}`);
                }
                else {
                    this.chat.appendLog(`^!${index} (inactive) ${publicKey.toString("hex")}${you}`);
                }
            });
        }
        else if (command.startsWith("/channels")) {
            this.chat.appendLog("^!Channels:");

            const channels = this.channelListController?.getItems() ?? [];

            if (channels.length <= 0) {
                this.chat.appendLog(`^!No channels available`);
            } else {
                channels.forEach( (item: CRDTViewItem, index: number) => {
                    const channel = item.data as Channel;

                    this.chat.appendLog(`^!${index} ${channel.name}, isOpen: ${channel.controller !== undefined}, isPrivate: ${channel.isPrivate}`);
                });
            }
        }
        else if (command.startsWith("/q ")) {
            const index = parseInt(command.slice(3));

            const activeList = this.presenceController?.getActiveList() ?? [];
            const inactiveList = this.presenceController?.getInactiveList() ?? [];

            const all = [...activeList, ...inactiveList];

            const publicKey = all[index];

            if (publicKey) {
                this.chat.appendLog(`^!Creating private channel with ${publicKey.toString("hex")}`);

                assert(this.channelListController);

                const channelNode = await this.channelListController.makePrivateChannel(publicKey);

                this.chat.appendLog(`^!Channel created with id1 ${JSON.parse(channelNode.toString()).id1}`);
            } else {
                if (isNaN(index)) {
                    this.chat.appendLog(`^!Unable to create a new channel without the index. Try: /q 123`);
                } else {
                    this.chat.appendLog(`^!Public key with index ${index} is not present. Try: /presence`);
                }
            }
        }
        else if (command.startsWith("/open ")) {
            const index = parseInt(command.slice(6));

            assert(this.channelListController);

            this.channelListController.getActiveController()?.close();

            const channels = this.channelListController.getItems().map( item => item.id1 );

            const channelId1 = channels[index];

            if (channelId1) {
                this.chat.appendLog(`^!Open channel with ${channelId1.toString("hex")}`);

                assert(this.channelListController);

                const controller = await this.channelListController.openChannel(channelId1);

                this.channelListController.setChannelActive(channelId1);

                controller.onChange( (added: CRDTViewItem[]) =>
                    this.drawLastItems(controller, added) );

            } else {
                if (isNaN(index)) {
                    this.chat.appendLog(`^!Unable to open existing channel without the index. Try: /open 123`);
                } else {
                    this.chat.appendLog(`^!Channel with index ${index} does not exist. Try: /channels`);
                }
            }
        }
        else {
            this.chat.appendLog(`^!Unknown command: ${command}`);
        }
    }

    protected redraw(controller: MessageController) {
        controller.getItems().forEach( (item: CRDTViewItem) => {
            const message = item.data as Message;

            this.chat.appendLog(`${message.creationTimestamp} ${message.publicKey}: ${message.text}`);
        });
    }

    protected drawLastItems(controller: MessageController, added: CRDTViewItem[]) {
        // Render all messages which are appended to the model.
        // Note that messages could be inserted at different locations into the model
        // depending on when they are synced and these "old" messages will not be rendered
        // here. To render a complete window of the model user controller.getItems().
        //
        let lastItemIndex = -1;

        if (this.lastRenderedItemId1) {
            lastItemIndex = controller.findItem(this.lastRenderedItemId1)?.index ?? -1;
        }

        added.forEach( (item: CRDTViewItem) => {
            if (item.index > lastItemIndex) {
                const message = item.data as Message;

                this.chat.appendLog(`${message.creationTimestamp} ${message.publicKey}: ${message.text}`);
            }
        });

        this.lastRenderedItemId1 = controller.getLastItem()?.id1;
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
