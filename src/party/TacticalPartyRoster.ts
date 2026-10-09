/** Runtime party membership for controllable actors.
 *
 * This is intentionally separate from the story recruitment PartyRoster:
 * tactical membership is an in-memory actor list and does not persist story
 * recruitment or dialogue state.
 */
export type TacticalPartyMemberId = string;

export type TacticalPartyMemberDescriptor = {
  id: TacticalPartyMemberId;
  displayName: string;
  actorRef?: unknown;
  portraitId?: string;
  controllable: boolean;
  alive: boolean;
  hp?: number;
};

export class TacticalPartyRoster {
  private readonly members = new Map<TacticalPartyMemberId, TacticalPartyMemberDescriptor>();
  private readonly order: TacticalPartyMemberId[] = [];

  constructor(initial: TacticalPartyMemberDescriptor[] = []) {
    initial.forEach(member => this.addMember(member));
  }

  addMember(member: TacticalPartyMemberDescriptor) {
    if (!member.id || this.members.has(member.id)) return false;
    this.members.set(member.id, { ...member });
    this.order.push(member.id);
    return true;
  }

  removeMember(memberId: TacticalPartyMemberId) {
    if (!this.members.delete(memberId)) return false;
    const index = this.order.indexOf(memberId);
    if (index >= 0) this.order.splice(index, 1);
    return true;
  }

  getMember(memberId: TacticalPartyMemberId) {
    return this.members.get(memberId) ?? null;
  }

  hasMember(memberId: TacticalPartyMemberId) {
    return this.members.has(memberId);
  }

  updateMember(memberId: TacticalPartyMemberId, patch: Partial<Omit<TacticalPartyMemberDescriptor, "id">>) {
    const current = this.members.get(memberId);
    if (!current) return false;
    this.members.set(memberId, { ...current, ...patch });
    return true;
  }

  listIds() {
    return [...this.order];
  }

  listMembers() {
    return this.order.map(id => this.members.get(id)!).filter(Boolean).map(member => ({ ...member }));
  }

  get size() {
    return this.order.length;
  }
}
