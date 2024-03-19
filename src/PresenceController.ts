import crypto from "crypto";

import {
    CRDTVIEW_EVENT,
    Hash,
    ThreadController,
    ThreadControllerParams,
    Service,
} from "openodin";

export type PresenceState = {
    /** Last user activity detected (mouse move, etc). */
    lastActivityDetected: number,

    /** True if local user is active. */
    isActive: boolean,

    /** List of public keys of active users. */
    active: Buffer[],

    /** List of public keys of inactive users. */
    inactive: Buffer[],

    /** List of incoming presence nodes which are filtered into active or inactive lists. */
    presenceNodes: {[hash: string]: {
        /** Owner public key of the presence node (user). */
        publicKey: Buffer,

        /**
         * List of timestamp of when nodes came in, maximum two are kept.
         * The diff of the two timestamp is used to determine if the user is active,
         * also that the last timestamp is not too old.
         */
        pings: number[],
    }},
};

// Users show as inactive after this threshold.
const INACTIVE_THRESHOLD = 1 * 60 * 1000;  // one minute

export class PresenceController extends ThreadController {
    protected pulseTimer?: ReturnType<typeof setTimeout>;

    protected refreshInterval?: ReturnType<typeof setInterval>;

    protected state: PresenceState;

    protected instanceRandomId: Buffer;

    constructor(params: ThreadControllerParams, service: Service) {

        params.threadName = params.threadName ?? "presence";

        super(params, service);

        // These random bytes are used to differentiate when a user is present
        // on more than one app at the same time, which is important to be able
        // to detect time intervals properly for active status.
        //
        this.instanceRandomId = crypto.randomBytes(4);

        //self.crypto.getRandomValues(this.instanceRandomId);

        this.state = {
            lastActivityDetected: 0,
            isActive: false,
            active: [],
            inactive: [],
            presenceNodes: {},
        };

        this.onChange( (event: CRDTVIEW_EVENT) => this.handleOnChange(event) );

        this.refreshInterval = setInterval(() => this.refreshPresence(), INACTIVE_THRESHOLD / 4);
    }

    /**
     * Repeatadly post a presence node on an interval,
     * if the presence is active.
     *
     * @param force set to true to force send a presence node
     */
    protected postPresence(force: boolean = false) {
        // Clear in case is called outside setTimeout.
        //
        clearTimeout(this.pulseTimer);

        this.pulseTimer = undefined;

        if (this.isActive() || force) {
            this.thread.post("presence", {data: this.instanceRandomId});
        }

        this.pulseTimer = setTimeout(() => this.postPresence(), INACTIVE_THRESHOLD);
    }

    /**
     * Called from the outside whenever activity is detected.
     * If current state is inactive then immediately send a presence node.
     */
    public activityDetected() {
        this.state.lastActivityDetected = Date.now();

        if (!this.isActive()) {
            this.state.isActive = true;

            this.triggerEvent("active");

            this.postPresence(true);
        }
    }

    public isActive(): boolean {
        return this.state.isActive;
    }

    public onActive(cb: () => void): PresenceController {
        this.hookEvent("active", cb);
        return this;
    }

    public onInactive(cb: () => void): PresenceController {
        this.hookEvent("inactive", cb);
        return this;
    }

    /**
     * @returns list of public keys of active users.
     */
    public getActiveList(): Buffer[] {
        return this.state.active;
    }

    /**
     * @returns list of public keys of inactive users.
     */
    public getInactiveList(): Buffer[] {
        return this.state.inactive;
    }

    /**
     * Check if given public key is active.
     *
     * @param publicKey is hex-string for convenience in UI.
     */
    public isPresent(publicKeyStr: string): boolean {
        const publicKey = Buffer.from(publicKeyStr, "hex");

        return this.getActiveList().findIndex( publicKey2 => publicKey.equals(publicKey) ) >= 0;
    }

    /**
     * In this controller it makes more sense to hook the onChange event rather than implementing the
     * makeData() function since we are using a special struct which is not per node.
     */
    protected handleOnChange(event: CRDTVIEW_EVENT) {
        event.added.forEach( id1 => {
            const node = this.getNode(id1);

            const publicKey = node?.getOwner();

            if (!node || !publicKey) {
                return;
            }

            // We hash like this to let the same user run multiple apps simultanously.
            // The app will populate data with some random bytes which represents the app instance.
            //
            const hashStr = Hash([publicKey, node.getData()]).toString("hex");

            const presenceNode = this.state.presenceNodes[hashStr] ?? {
                publicKey,
                pings: [Date.now()],
            };

            this.state.presenceNodes[hashStr] = presenceNode;

            presenceNode.pings.unshift(Date.now());

            presenceNode.pings.length = 2;
        });

        this.refreshPresence();
    }

    protected refreshPresence = () => {
        // Check if user is going inactive.
        //
        //if (this.isActive()) {
            //if (Date.now() - this.state.lastActivityDetected >= INACTIVE_THRESHOLD) {
                //this.state.isActive = false;

                //this.triggerEvent("inactive");
            //}
        //}

        // Filter users into active or inctive bucktes based on their last ping.
        //
        const active: {[id1: string]: Buffer} = {};

        const inactive: {[id1: string]: Buffer} = {};

        for (const hashStr in this.state.presenceNodes) {
            const presenceNode = this.state.presenceNodes[hashStr];

            const delta = presenceNode.pings[0] - presenceNode.pings[1];
            const timeDiff = Date.now() - presenceNode.pings[0];

            // Active if spaced out pings and not too old last ping.
            //
            const isActive = delta >= INACTIVE_THRESHOLD * 0.5 && timeDiff < INACTIVE_THRESHOLD * 1.5;

            if (isActive) {
                active[presenceNode.publicKey.toString("hex")] = presenceNode.publicKey;
                delete inactive[presenceNode.publicKey.toString("hex")];
            }
            else {
                delete active[presenceNode.publicKey.toString("hex")];
                inactive[presenceNode.publicKey.toString("hex")] = presenceNode.publicKey;
            }
        }

        this.state.active   = Object.values(active);
        this.state.inactive = Object.values(inactive);

        this.update();
    }

    public close() {
        super.close();

        clearInterval(this.refreshInterval);

        clearTimeout(this.pulseTimer);
    }
}
