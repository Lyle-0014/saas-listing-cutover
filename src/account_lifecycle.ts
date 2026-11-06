export type AccountState = "onboarding" | "active" | "suspended" | "offboarded";
export type AdminAction = "activate" | "suspend" | "restore" | "offboard";

const transitions: Record<AccountState, Partial<Record<AdminAction, AccountState>>> = {
  onboarding: { activate: "active", offboard: "offboarded" },
  active: { suspend: "suspended", offboard: "offboarded" },
  suspended: { restore: "active", offboard: "offboarded" },
  offboarded: {},
};

export function applyAdminAction(state: AccountState, action: AdminAction): AccountState {
  const next = transitions[state][action];
  if (!next) throw new Error(`Cannot ${action} an account in ${state}`);
  return next;
}
