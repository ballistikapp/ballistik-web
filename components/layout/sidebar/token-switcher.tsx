"use client";

import * as React from "react";
import {
  Check,
  ChevronsUpDown,
  GalleryVerticalEnd,
  Plus,
  Settings,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryState } from "nuqs";

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
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { UserTokensOutput } from "@/server/services/token.service";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { tokenQueryParser } from "@/lib/utils/token-query";
import { Button } from "@/components/ui/button";

const TOKEN_SPECIFIC_ROUTES = ["dashboard", "token"];
const SELECTED_TOKEN_KEY = "selected-token-public-key";

export const TokenSwitcher = React.memo(function TokenSwitcher({
  tokens,
}: {
  tokens: UserTokensOutput;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentTokenPublicKey, setToken] = useQueryState(
    "token",
    tokenQueryParser
  );

  const [storedTokenPublicKey] = React.useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(SELECTED_TOKEN_KEY);
    }
    return null;
  });

  React.useEffect(() => {
    if (currentTokenPublicKey) {
      localStorage.setItem(SELECTED_TOKEN_KEY, currentTokenPublicKey);
    }
  }, [currentTokenPublicKey]);

  const tokenMap = React.useMemo(() => {
    const map = new Map<string, (typeof tokens)[0]>();
    tokens.forEach((token) => {
      map.set(token.publicKey, token);
    });
    return map;
  }, [tokens]);

  const selectedToken = React.useMemo(() => {
    if (currentTokenPublicKey && tokenMap.has(currentTokenPublicKey)) {
      return tokenMap.get(currentTokenPublicKey);
    }
    if (storedTokenPublicKey && tokenMap.has(storedTokenPublicKey)) {
      return tokenMap.get(storedTokenPublicKey);
    }
    return tokens[0];
  }, [tokenMap, currentTokenPublicKey, storedTokenPublicKey, tokens]);

  const handleTokenSelect = React.useCallback(
    async (newTokenPublicKey: string) => {
      localStorage.setItem(SELECTED_TOKEN_KEY, newTokenPublicKey);

      const pathSegments = pathname.split("/").filter(Boolean);
      const currentPage = pathSegments[pathSegments.length - 1] || "dashboard";

      const isTokenSpecificRoute =
        TOKEN_SPECIFIC_ROUTES.includes(currentPage) ||
        ["dashboard", "holdings", "transactions", "wallets"].includes(
          currentPage
        );

      if (isTokenSpecificRoute) {
        await setToken(newTokenPublicKey);
      } else {
        router.push(`/dashboard?token=${newTokenPublicKey}`);
      }
    },
    [pathname, router, setToken]
  );

  const [open, setOpen] = React.useState(false);

  if (tokens.length === 0) {
    return (
      <Button asChild size="xl" className="w-full text-lg font-semibold">
        <Link href="/launch">Launch New Token</Link>
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg overflow-hidden shrink-0">
            {selectedToken?.imageUrl ? (
              <Image
                src={selectedToken.imageUrl}
                alt={selectedToken.name || "Token"}
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
            <span className="font-medium truncate">{selectedToken?.name}</span>
            <span className="text-muted-foreground truncate">
              {selectedToken?.symbol}
            </span>
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
                  <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg overflow-hidden shrink-0">
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
                    <span className="text-muted-foreground text-xs truncate">
                      {token.symbol}
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
            <CommandSeparator />
            <CommandGroup>
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
                  <span className="font-medium truncate ">
                    Launch New Token
                  </span>
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
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
