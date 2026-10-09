/**
 * Shared actor-agnostic control ownership for a controllable party.
 *
 * Character identity and runtime objects stay with each actor. This class only
 * records which existing actor receives direct control and which actor follows.
 * Combat, animation, weapons, camera, and navigation are integrated through
 * the two narrow callbacks rather than being owned here.
 */
export type ControlOwnershipId = string;

export type ControlOwnershipStatus = "IDLE" | "QUEUED" | "APPLYING";

export type ControlOwnershipSnapshot = {
  controlledActorId: ControlOwnershipId;
  followerActorId: ControlOwnershipId;
  swapCount: number;
  rejectedUnsafeSwaps: number;
  queuedSwap: ControlOwnershipId | null;
  pendingActorId: ControlOwnershipId | null;
  status: ControlOwnershipStatus;
};

export class CharacterControlOwnership {
  private controlledActorId: ControlOwnershipId;
  private followerActorId: ControlOwnershipId;
  private swapCount = 0;
  private rejectedUnsafeSwaps = 0;
  private queuedSwap: ControlOwnershipId | null = null;
  private transitionStatus: ControlOwnershipStatus = "IDLE";

  constructor(
    controlledActorId: ControlOwnershipId,
    followerActorId: ControlOwnershipId,
    private readonly canTransfer: (from: ControlOwnershipId, to: ControlOwnershipId) => boolean,
    private readonly onTransfer: (from: ControlOwnershipId, to: ControlOwnershipId) => void,
  ) {
    if (controlledActorId === followerActorId) throw new Error("CONTROL_OWNERSHIP_DUPLICATE_ACTOR");
    this.controlledActorId = controlledActorId;
    this.followerActorId = followerActorId;
  }

  get controlled() { return this.controlledActorId; }
  get follower() { return this.followerActorId; }
  get queued() { return this.queuedSwap; }
  get status() { return this.transitionStatus; }

  cancelQueuedTransfer() {
    if (!this.queuedSwap) return false;
    this.queuedSwap = null;
    this.transitionStatus = "IDLE";
    return true;
  }

  requestSwap() {
    return this.setControlled(this.followerActorId);
  }

  setControlled(actorId: ControlOwnershipId) {
    if (actorId === this.controlledActorId) return true;
    if (actorId !== this.followerActorId) return false;
    if (!this.canTransfer(this.controlledActorId, actorId)) {
      this.rejectedUnsafeSwaps += 1;
      this.queuedSwap = actorId;
      this.transitionStatus = "QUEUED";
      return false;
    }
    const previous = this.controlledActorId;
    this.transitionStatus = "APPLYING";
    try {
      this.controlledActorId = actorId;
      this.followerActorId = previous;
      this.queuedSwap = null;
      this.swapCount += 1;
      this.onTransfer(previous, actorId);
      return true;
    } finally {
      this.transitionStatus = "IDLE";
    }
  }

  /** Retries a previously rejected request after the actor settles. */
  flushQueuedSwap() {
    if (!this.queuedSwap) return false;
    return this.setControlled(this.queuedSwap);
  }

  snapshot(): ControlOwnershipSnapshot {
    return {
      controlledActorId: this.controlledActorId,
      followerActorId: this.followerActorId,
      swapCount: this.swapCount,
      rejectedUnsafeSwaps: this.rejectedUnsafeSwaps,
      queuedSwap: this.queuedSwap,
      pendingActorId: this.queuedSwap,
      status: this.transitionStatus,
    };
  }
}
