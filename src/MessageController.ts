import {
    Service,
    ThreadController,
    DataInterface,
    ThreadControllerParams,
    ThreadDataParams,
} from "openodin";

/**
 * The collected data we have to display a message.
 */
export type Message = {
    text: string,
    publicKey: string,
    id1: string,
    creationTimestamp: string,
};

export class MessageController extends ThreadController {
    protected channelNode: DataInterface;

    /** License targets. */
    private targets: Buffer[] = [];

    /**
     * @param thread controller params
     * @param channelNode the data node representing the channel
     */
    constructor(params: ThreadControllerParams, service: Service, channelNode: DataInterface) {
        // "channel" refers to the JSON configuration threads.channel
        params.threadName       = params.threadName ?? "channel";
        params.threadDefaults   = params.threadDefaults ?? {};
        params.threadDefaults.parentId = channelNode.getId();

        super(params, service);

        this.channelNode = channelNode;

        if (MessageController.IsPrivateChannel(channelNode)) {
            this.targets.push(channelNode.getOwner()!);

            const refId = channelNode.getRefId();

            if (refId && !channelNode.getOwner()?.equals(refId)) {
                this.targets.push(refId);
            }
        }
        else {
            // TODO: what kind of permmissions do we want?
        }
    }

    /**
     * If a channel data node has refId field set this decides that the channel
     * is a private channel between two peers: the owner of the data node and
     * the peer who's public key is set in the refId field of the data node.
     *
     * @params channelNode the node representing the channel
     * @returns true if the channel is private
     */
    public static IsPrivateChannel(channelNode: DataInterface): boolean {
        return (channelNode.getRefId()?.length ?? 0) > 0;
    }

    /**
     * Get the name of the channel.
     * If the channel is private the name is the public key of the other peer.
     *
     * @param 
     *
     * @returns name of the channel
     */
    public static GetName(channelNode: DataInterface, publicKey: Buffer): string {
        if (MessageController.IsPrivateChannel(channelNode)) {
            if (channelNode.getRefId()?.equals(publicKey)) {
                return channelNode.getOwner()!.toString("hex");
            }
            else {
                return channelNode.getRefId()!.toString("hex");
            }
        }

        return channelNode.getData()?.toString() ?? "<no name>";
    }

    /**
     * Whenever a new node is added to the view or an existing node is updated
     * this function is called to format the node associated data for our purposes.
     *
     * @param node the node
     * @param message the data object to set (in place) associated with node
     */
    protected makeData(node: DataInterface, message: any) {
        message.text                = node.getData()?.toString();
        message.publicKey           = node.getOwner()!.toString("hex");
        message.id1                 = node.getId1()!.toString("hex");
        message.creationTimestamp   = new Date(node.getCreationTime()!);
    }

    /**
     * Automatically called when a Message should be purged to free allocated memory.
     *
     * @param message
     */
    protected purgeData(message: Message) {  //eslint-disable-line @typescript-eslint/no-unused-vars
        // Do nothing
    }

    /**
     * @throws on error
     */
    public async sendMessage(text: string) {
        const params: ThreadDataParams = {
            // Refer to the last message as refId.
            // This is so the CRDT algorithm can sort the messages.
            refId: this.getLastItem()?.node.getId1(),

            // The message sent.
            data: Buffer.from(text),
        };

        const node = await this.thread.post("message", params);

        console.info("sent message", node.getParentId());

        if (node.isLicensed()) {
            await this.thread.postLicense("default", node, { targets: this.targets });
        }
    }
}

