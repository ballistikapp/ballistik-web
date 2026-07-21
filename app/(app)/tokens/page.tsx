"use client";

import Link from "next/link";
import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { copyToClipboard } from "@/lib/utils";
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableViewOptions,
} from "@/components/data-table";
import { PageHeader } from "@/components/layout/sections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { TokenReclaimDialog } from "@/components/launch/token-reclaim-dialog";
import { createTokenColumns } from "./columns";
import { mapUserTokenToTableRow, type TokenTableRow } from "./token-rows";

export default function MyTokensPage() {
  const { data, isLoading } = trpc.token.getAllUserTokens.useQuery(
    { page: 1, pageSize: 100 },
    {
      refetchOnMount: "always",
    }
  );
  const getPrivateKeyMutation = trpc.token.getPrivateKey.useMutation();

  const [reclaimTokenPublicKey, setReclaimTokenPublicKey] = React.useState<
    string | null
  >(null);
  const [privateKeyDialogOpen, setPrivateKeyDialogOpen] = React.useState(false);
  const [privateKey, setPrivateKey] = React.useState<string | null>(null);
  const [privateKeyTarget, setPrivateKeyTarget] =
    React.useState<TokenTableRow | null>(null);

  const tableRows: TokenTableRow[] = React.useMemo(() => {
    if (!data?.items) return [];
    return data.items.map(mapUserTokenToTableRow);
  }, [data?.items]);

  const handlePrivateKeyDialogChange = (open: boolean) => {
    setPrivateKeyDialogOpen(open);
    if (!open) {
      setPrivateKey(null);
      setPrivateKeyTarget(null);
      getPrivateKeyMutation.reset();
    }
  };

  const handleGetPrivateKey = async () => {
    const tokenPublicKey = privateKeyTarget?.publicKey;
    if (!tokenPublicKey) return;
    try {
      const result = await getPrivateKeyMutation.mutateAsync({
        publicKey: tokenPublicKey,
      });
      setPrivateKey(result.privateKey);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch private key";
      toast.error(message);
    }
  };

  const columns = React.useMemo(
    () =>
      createTokenColumns({
        onReclaim: (row) => {
          setReclaimTokenPublicKey(row.publicKey);
        },
        onShowPrivateKey: (row) => {
          setPrivateKeyTarget(row);
          setPrivateKeyDialogOpen(true);
        },
      }),
    []
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My Tokens"
        rightContent={
          <Button asChild>
            <Link href="/launch">
              <Plus className="size-4" />
              Launch New Token
            </Link>
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={tableRows}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        searchableColumns={["name", "symbol", "publicKey"]}
        toolbar={(table) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <DataTableSearch
              table={table}
              placeholder="Search tokens..."
              className="w-full sm:max-w-sm"
            />
            <DataTableViewOptions table={table} />
          </div>
        )}
        pagination={(table) => <DataTablePagination table={table} />}
      />
      <TokenReclaimDialog
        open={Boolean(reclaimTokenPublicKey)}
        onOpenChange={(open) => {
          if (!open) {
            setReclaimTokenPublicKey(null);
          }
        }}
        tokenPublicKey={reclaimTokenPublicKey}
      />
      <Dialog
        open={privateKeyDialogOpen}
        onOpenChange={handlePrivateKeyDialogChange}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Private key</DialogTitle>
            <DialogDescription>
              Fetch and copy the private key for this token.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {privateKey ? (
              <Textarea
                readOnly
                rows={4}
                value={privateKey}
                className="font-mono text-xs"
              />
            ) : (
              <div className="text-sm text-muted-foreground">
                Click get private key to fetch it from the server.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handlePrivateKeyDialogChange(false)}
              disabled={getPrivateKeyMutation.isPending}
            >
              Close
            </Button>
            {privateKey ? (
              <Button
                onClick={() => copyToClipboard(privateKey, "Private key")}
              >
                Copy private key
              </Button>
            ) : (
              <Button
                onClick={handleGetPrivateKey}
                disabled={
                  getPrivateKeyMutation.isPending ||
                  !privateKeyTarget?.publicKey
                }
              >
                {getPrivateKeyMutation.isPending && (
                  <Spinner className="mr-2 size-4" />
                )}
                Get private key
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
