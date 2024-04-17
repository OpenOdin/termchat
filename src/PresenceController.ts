import crypto from "crypto";

import {
    CRDTViewItem,
    Hash,
    ThreadController,
    ThreadFetchParams,
    ThreadTemplate,
    Service,
    NodeInterface,
} from "openodin";

export type PresenceItem = {
    publicKey: Buffer,
    creationTime: number,
    displayName: string,
};

export type PresenceState = {
    /** Last user activity detected (mouse move, etc). */
    lastActivityDetected: number,

    /** True if local user is active. */
    isActive: boolean,

    /** Quick lookup checking active users. */
    active: {[publicKey: string]: true},

    /** List of public keys of active users. */
    activeList: PresenceItem[],

    /** List of public keys of inactive users. */
    inactiveList: PresenceItem[],

    presence: {[publicKey: string]: PresenceItem},
};

// Users show as inactive after this threshold, about.
//
const INACTIVE_THRESHOLD = 1 * 60 * 1000;  // one minute

export class PresenceController extends ThreadController {
    protected pulseTimer?: ReturnType<typeof setTimeout>;

    protected refreshTimer?: ReturnType<typeof setTimeout>;

    protected state: PresenceState;

    constructor(service: Service, threadTemplate: ThreadTemplate,
        threadFetchParams: ThreadFetchParams = {})
    {
        super(service, threadTemplate, threadFetchParams);

        this.state = {
            lastActivityDetected: 0,
            isActive: false,
            active: {},
            activeList: [],
            inactiveList: [],
            presence: {},
        };

        this.onData( (added: NodeInterface[]) => this.handleOnChange(added) );

        this.refreshTimer = setTimeout(() => this.refreshPresence(), INACTIVE_THRESHOLD / 4);

        this.pulseTimer = setTimeout( () => this.postPresence(), INACTIVE_THRESHOLD);

        this.thread.post("existence");
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
            this.thread.post("presence");
        }

        this.pulseTimer = setTimeout( () => this.postPresence(), INACTIVE_THRESHOLD);
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
    public getActiveList(): PresenceItem[] {
        return this.state.activeList;
    }

    /**
     * @returns list of public keys of inactive users.
     */
    public getInactiveList(): PresenceItem[] {
        return this.state.inactiveList;
    }

    /**
     * Check if given public key is active.
     *
     * @param publicKey is hex-string for convenience in UI.
     */
    public isPresent(publicKeyStr: string): boolean {
        return this.state.active[publicKeyStr];
    }

    /**
     * In this controller it makes more sense to hook the onChange event rather than implementing the
     * makeData() function since we are using a special struct which is not per node.
     */
    protected handleOnChange(added: NodeInterface[]) {
        added.forEach( node => {
            const publicKey = node?.getOwner();

            if (!node || !publicKey) {
                return;
            }

            const publicKeyStr = publicKey.toString("hex");

            const item = this.state.presence[publicKeyStr];
            const creationTime = node.getCreationTime() ?? 0;

            if (!item || item.creationTime < creationTime) {
                this.state.presence[publicKeyStr] = {
                    publicKey,
                    creationTime,
                    displayName: publicKey.toString("hex"),
                };
            }
        });

        if (added.length > 0) {
            this.refreshPresence();
        }
    }

    protected refreshPresence = () => {
        // Check if user is going inactive.
        //
        if (this.isActive()) {
            if (Date.now() - this.state.lastActivityDetected >= INACTIVE_THRESHOLD) {
                this.state.isActive = false;

                this.triggerEvent("inactive");
            }
        }

        this.state.active = {};
        this.state.activeList = [];
        this.state.inactiveList = [];

        for (const publicKeyStr in this.state.presence) {
            const item = this.state.presence[publicKeyStr];

            const diff = Date.now() - item.creationTime;

            if (diff < INACTIVE_THRESHOLD * 1.5) {
                this.state.active[publicKeyStr] = true;
                this.state.activeList.push(item);
            }
            else {
                this.state.inactiveList.push(item);
            }
        }

        // Sort on public key
        //
        this.state.activeList.sort( (a, b) => a.publicKey.compare(b.publicKey) );

        // Sort on creationTime descending
        //
        this.state.inactiveList.sort( (a, b) => b.creationTime - a.creationTime );

        this.update();
    }

    public close() {
        super.close();

        clearTimeout(this.refreshTimer);

        clearTimeout(this.pulseTimer);
    }
}
