"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { request, send } from "@/lib/send";
import { CheckList, type Option } from "./check-list";
import { InviteLink } from "./invite-link";

type Props = { staffId: string; name: string; active: boolean; roles: Option[]; branches: Option[]; roleIds: string[]; branchIds: string[] };

// Roles and branches (saved together), a fresh invite link, on/off.
export function StaffManage({ staffId, name, active, roles, branches, roleIds: initialRoles, branchIds: initialBranches }: Props) {
  const router = useRouter();
  const [roleIds, setRoleIds] = useState(initialRoles);
  const [branchIds, setBranchIds] = useState(initialBranches);
  const [msg, setMsg] = useState<string>();
  const [token, setToken] = useState<string>();
  const [busy, setBusy] = useState(false);
  const post = async (body: object) => {
    setBusy(true);
    const r = await request<{ token?: string }>(`/api/staff/${staffId}`, "POST", body);
    setBusy(false);
    return r;
  };

  return (
    <div className="flex flex-col gap-5">
      <CheckList legend="Roles" options={roles} value={roleIds} onChange={setRoleIds} />
      {branches.length > 1 ? <CheckList legend="Branches (none = all)" options={branches} value={branchIds} onChange={setBranchIds} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          disabled={busy}
          onClick={async () => {
            const r = await post({ action: "access", roleIds, branchIds });
            setMsg(r.error ?? "Saved ✓");
            if (!r.error) router.refresh();
          }}
        >
          Save access
        </Button>
        {msg ? <span className={msg === "Saved ✓" ? "text-label text-success-600" : "text-label text-danger-600"}>{msg}</span> : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
        {active ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              const r = await post({ action: "invite" });
              if (r.error !== undefined) setMsg(r.error);
              else setToken(r.data.token);
            }}
          >
            New invite link
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className={active ? "text-danger-600" : undefined}
          disabled={busy}
          onClick={async () => {
            const err = await send(`/api/staff/${staffId}`, "POST", { action: active ? "deactivate" : "reactivate" });
            if (err) setMsg(err);
            else router.refresh();
          }}
        >
          {active ? "Turn off access" : "Turn access back on"}
        </Button>
      </div>
      {token ? <InviteLink token={token} name={name} /> : null}
    </div>
  );
}
