"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WalletIcon, XIcon } from "lucide-react";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const WALLET_ADAPTER_HIGHLIGHT =
  "radial-gradient(75% 181.15942028985506% at 50% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)";

type WalletAdapterButtonProps = {
  size?: "default" | "compact";
  className?: string;
};

function truncate(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function WalletAdapterButton({
  size = "default",
  className,
}: WalletAdapterButtonProps) {
  const {
    connected,
    connecting,
    publicKey,
    disconnect,
    disconnecting,
    wallet,
  } = useWallet();
  const { setVisible } = useWalletModal();
  const isCompact = size === "compact";

  const handleConnect = () => {
    setVisible(true);
  };

  const handleDisconnect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await disconnect();
    } catch {
      // Adapter throws if there's nothing to disconnect; safe to ignore.
    }
  };

  const adapterIcon = wallet?.adapter.icon;
  const adapterName = wallet?.adapter.name;
  const iconSize = isCompact ? 16 : 20;

  const renderLeadingIcon = () => {
    if (adapterIcon) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={adapterIcon}
          alt={adapterName ?? "Wallet"}
          width={iconSize}
          height={iconSize}
          className="shrink-0 rounded-sm"
        />
      );
    }
    return (
      <WalletIcon
        className={cn("shrink-0", isCompact ? "h-4 w-4" : "h-5 w-5")}
        aria-hidden
      />
    );
  };

  return (
    <HoverBorderGradient
      as="div"
      containerClassName={cn("group rounded-lg w-full", className)}
      className={cn(
        "w-full bg-background flex items-stretch text-foreground rounded-md",
        isCompact ? "text-sm font-medium" : "text-base font-medium md:text-lg"
      )}
      highlight={WALLET_ADAPTER_HIGHLIGHT}
    >
      {connected && publicKey ? (
        <div
          className={cn(
            "flex w-full items-center gap-2 bg-background",
            isCompact ? "px-2 py-1 min-h-8" : "px-3 py-2 min-h-10"
          )}
        >
          {renderLeadingIcon()}
          <span
            className={cn(
              "flex-1 font-mono truncate text-left",
              isCompact ? "text-xs" : "text-sm md:text-base"
            )}
          >
            {truncate(publicKey.toBase58())}
          </span>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            aria-label="Disconnect wallet"
            className={cn(
              "ml-auto shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors",
              isCompact ? "h-6 w-6" : "h-7 w-7"
            )}
          >
            {disconnecting ? (
              <Spinner className={isCompact ? "size-3" : "size-4"} />
            ) : (
              <XIcon
                className={isCompact ? "h-3.5 w-3.5" : "h-4 w-4"}
                aria-hidden
              />
            )}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className={cn(
            "w-full flex items-center justify-center gap-2 bg-background hover:bg-background/85 rounded-md transition-colors",
            isCompact
              ? "px-2 py-1 min-h-8 text-sm"
              : "px-3 py-2 min-h-10 text-base md:text-lg"
          )}
        >
          {connecting ? (
            <>
              <Spinner className={isCompact ? "size-3" : "size-4"} />
              <span>Connecting...</span>
            </>
          ) : (
            <>
              {renderLeadingIcon()}
              <span>Connect Wallet</span>
            </>
          )}
        </button>
      )}
    </HoverBorderGradient>
  );
}
