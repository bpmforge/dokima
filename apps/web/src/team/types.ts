/** A member of the org as the Team surfaces need it (W20-01/W20-02). */
export interface TeamMember {
  /** The real roster/actor id — never replaced by the face (D-028). */
  readonly actorId: string;
  readonly role: string;
  /** Absent when this role has no persona: surfaces then render `actorId`. */
  readonly displayName?: string;
  readonly avatar?: string;
  readonly jobLine?: string;
}
