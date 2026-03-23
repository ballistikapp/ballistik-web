"use client";

import * as React from "react";
import {
  Check,
  ChevronsUpDown,
  GalleryVerticalEnd,
  Plus,
  Settings,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import type { UserTokenItems } from "@/server/services/token.service";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useSelectedToken } from "@/hooks/use-selected-token";

export const TokenSwitcher = React.memo(function TokenSwitcher({
  tokens,
}: {
  tokens: UserTokenItems;
}) {
  const router = useRouter();
  const { state } = useSidebar();
  const { selectedTokenPublicKey, setSelectedTokenPublicKey } =
    useSelectedToken();

  const tokenMap = React.useMemo(() => {
    const map = new Map<string, (typeof tokens)[0]>();
    tokens.forEach((token) => {
      map.set(token.publicKey, token);
    });
    return map;
  }, [tokens]);

  const selectedToken = React.useMemo(() => {
    if (selectedTokenPublicKey && tokenMap.has(selectedTokenPublicKey)) {
      return tokenMap.get(selectedTokenPublicKey);
    }
    if (selectedTokenPublicKey && !tokenMap.has(selectedTokenPublicKey)) {
      setSelectedTokenPublicKey(null);
    }
    return tokens[0];
  }, [tokenMap, selectedTokenPublicKey, tokens, setSelectedTokenPublicKey]);

  const handleTokenSelect = React.useCallback(
    (newTokenPublicKey: string) => {
      setSelectedTokenPublicKey(newTokenPublicKey);
      router.push(`/${newTokenPublicKey}/dashboard`);
    },
    [router, setSelectedTokenPublicKey]
  );

  const [open, setOpen] = React.useState(false);
  const isSidebarCollapsed = state === "collapsed";

  React.useEffect(() => {
    if (isSidebarCollapsed && open) {
      setOpen(false);
    }
  }, [isSidebarCollapsed, open]);

  if (tokens.length === 0) {
    return (
      <SidebarMenuButton
        asChild
        size="lg"
        tooltip="Launch New Token"
        className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center"
      >
        <Link href="/launch" aria-label="Launch New Token">
          {isSidebarCollapsed ? (
            <Plus className="size-5 shrink-0" />
          ) : (
            <>
              <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg shrink-0">
                <Plus className="size-4" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
                <span className="truncate font-semibold">Launch New Token</span>
                <span className="text-muted-foreground truncate text-xs">
                  Create your first token
                </span>
              </div>
            </>
          )}
        </Link>
      </SidebarMenuButton>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) =>
        setOpen(isSidebarCollapsed ? false : nextOpen)
      }
    >
      <PopoverTrigger asChild>
        <SidebarMenuButton
          size="lg"
          disabled={isSidebarCollapsed}
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground py-6 disabled:opacity-100"
        >
          <div className="flex aspect-square size-10 items-center justify-center rounded-xl overflow-hidden shrink-0 bg-sidebar-primary text-sidebar-primary-foreground">
            {selectedToken?.imageUrl ? (
              <Image
                src={selectedToken.imageUrl}
                alt={selectedToken.name || "Token"}
                className="h-full w-full object-cover"
                width={40}
                height={40}
                loading="lazy"
              />
            ) : (
              <GalleryVerticalEnd className="size-5" />
            )}
          </div>
          <div className="flex flex-col gap-1 leading-none min-w-0 flex-1">
            <span className="font-semibold text-sm truncate">
              {selectedToken?.name}
            </span>
            <Badge variant="secondary" className="text-xs font-mono w-fit">
              ${selectedToken?.symbol}
            </Badge>
          </div>
          <ChevronsUpDown className="ml-auto shrink-0 opacity-50" />
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search tokens..." className="h-9" />
          <CommandList>
            <CommandEmpty>No token found.</CommandEmpty>
            <CommandGroup>
              {tokens.map((token) => (
                <CommandItem
                  key={token.publicKey}
                  value={`${token.name} ${token.symbol} ${token.publicKey}`}
                  onSelect={() => {
                    handleTokenSelect(token.publicKey);
                    setOpen(false);
                  }}
                  className="gap-2 py-3"
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg overflow-hidden shrink-0 bg-sidebar-primary text-sidebar-primary-foreground">
                    {token.imageUrl ? (
                      <Image
                        src={token.imageUrl}
                        alt={token.name || "Token"}
                        className="h-full w-full object-cover"
                        width={32}
                        height={32}
                        loading="lazy"
                      />
                    ) : (
                      <GalleryVerticalEnd className="size-4" />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none min-w-0 flex-1">
                    <span className="font-medium truncate">{token.name}</span>
                    <span className="text-muted-foreground text-xs font-mono truncate">
                      ${token.symbol}
                    </span>
                  </div>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4 shrink-0",
                      selectedToken &&
                        token.publicKey === selectedToken.publicKey
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <CommandSeparator />
          <div className="p-1">
            <CommandItem
              value="launch new token"
              onSelect={() => {
                router.push("/launch");
                setOpen(false);
              }}
              className="gap-2 opacity-80 hover:opacity-100"
            >
              <div className="text-primary bg-muted flex aspect-square size-8 items-center justify-center rounded-lg shrink-0">
                <Plus className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none min-w-0 flex-1">
                <span className="font-medium truncate">Launch New Token</span>
              </div>
            </CommandItem>
            <CommandItem
              value="manage tokens"
              onSelect={() => {
                router.push("/tokens");
                setOpen(false);
              }}
              className="gap-2 opacity-80 hover:opacity-100"
            >
              <div className="bg-muted text-muted-foreground flex aspect-square size-8 items-center justify-center rounded-lg shrink-0">
                <Settings className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none min-w-0 flex-1">
                <span className="font-medium truncate">Manage Tokens</span>
              </div>
            </CommandItem>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
