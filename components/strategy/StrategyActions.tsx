"use client";
import { useRef, useState } from "react";
import { AlertDialog, DropdownMenu } from "radix-ui";
import { ArrowUpRight, Ellipsis, Pencil, Trash2 } from "lucide-react";
import Link from "@/components/Link";
import { API_MODE } from "@/lib/api";
import { raw } from "@/lib/api/live";
import { deletePreviewDraft } from "@/lib/api/preview-workspace";

export default function StrategyActions({
  id,
  name,
  href,
  running,
  onRemoved,
}: {
  id: string;
  name: string;
  href: string;
  running: boolean;
  onRemoved: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  async function remove() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (API_MODE === "mock") await deletePreviewDraft(id);
      else
        await raw("/strategies/" + encodeURIComponent(id), {
          method: "DELETE",
        });
      setConfirm(false);
      onRemoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the draft.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="q-row-actions">
      <Link
        className="q-row-edit"
        href={href}
        aria-label={(running ? "Open run for " : "Edit ") + name}
      >
        {running ? <ArrowUpRight size={14} /> : <Pencil size={13} />}
        <span>{running ? "Open run" : "Edit"}</span>
      </Link>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          ref={trigger}
          type="button"
          className="q-icon-action"
          aria-label={"More actions for " + name}
        >
          <Ellipsis size={17} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={5}
            className="q-row-menu"
            onCloseAutoFocus={(e) => {
              if (confirm) e.preventDefault();
            }}
          >
            <DropdownMenu.Item
              disabled={running}
              onSelect={() => {
                setError("");
                setConfirm(true);
              }}
            >
              <Trash2 size={14} />
              Remove strategy
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <AlertDialog.Root
        open={confirm}
        onOpenChange={(next) => {
          if (!lock.current) setConfirm(next);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="q-confirm-scrim" />
          <AlertDialog.Content
            className="q-confirm-dialog"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              trigger.current?.focus();
            }}
          >
            <AlertDialog.Title>Remove strategy?</AlertDialog.Title>
            <AlertDialog.Description>
              Remove “{name}” from your saved strategies?
            </AlertDialog.Description>
            {error && (
              <p role="alert" className="text-short">
                {error}
              </p>
            )}
            <footer>
              <AlertDialog.Cancel disabled={busy} className="q-action">
                Keep strategy
              </AlertDialog.Cancel>
              <button
                type="button"
                className="q-action q-remove-action"
                disabled={busy}
                onClick={remove}
              >
                {busy ? "Removing…" : "Remove strategy"}
              </button>
            </footer>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
