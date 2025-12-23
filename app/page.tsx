"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Globe } from "lucide-react"; // 加入 Globe icon

// ===== Type Definitions =====
interface MarketItem {
  id: number;
  name: string;
  iconUrl: string;
}

type PriceInfo = {
  minAll: number;
  minAllWorld?: string; // 新增：最低價伺服器
  minNQ: number;
  minNQWorld?: string; // 新增：NQ 最低價伺服器
  minHQ: number;
  minHQWorld?: string; // 新增：HQ 最低價伺服器
  listingsFetched: number;
  lastUploadTime?: number;
};

// ===== Config / Constants =====
const PAGE_SIZE = 100;
const LISTINGS_PER_ITEM = 20;

const CN_WORLDS = [
  { id: 4028, name: "伊弗利特" },
  { id: 4029, name: "迦樓羅" },
  { id: 4030, name: "利維坦" },
  { id: 4031, name: "鳳凰" },
  { id: 4032, name: "奧汀" },
  { id: 4033, name: "巴哈姆特" },
  { id: 4034, name: "拉姆" },
  { id: 4035, name: "泰坦" },
];

const DEFAULT_DC = "陸行鳥";

// ===== Helper Functions =====
function safeNum(v: any, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function parseIconUrl(iconData: any): string {
  if (!iconData) return "/placeholder.svg?height=64&width=64";
  const rawPath = iconData.path_hr1 || iconData.path;
  if (!rawPath) return "/placeholder.svg?height=64&width=64";
  return `https://v2.xivapi.com/api/asset?path=${encodeURIComponent(
    rawPath
  )}&format=png`;
}

export default function MarketplacePage() {
  // ===== State: IDs Management =====
  const [allMarketableIds, setAllMarketableIds] = useState<number[]>([]);
  const [displayIds, setDisplayIds] = useState<number[]>([]);

  // ===== State: Page Data =====
  const [pageItems, setPageItems] = useState<MarketItem[]>([]);
  const [isPageLoading, setIsPageLoading] = useState(false);

  // ===== State: Price =====
  const [priceMap, setPriceMap] = useState<Map<number, PriceInfo>>(new Map());
  const [priceLoading, setPriceLoading] = useState(false);

  // ===== State: UI =====
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedWorld, setSelectedWorld] = useState<string>(DEFAULT_DC);
  const [page, setPage] = useState(1);

  const gilFmt = useMemo(() => new Intl.NumberFormat("en-US"), []);

  // 總頁數根據 displayIds 計算
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(displayIds.length / PAGE_SIZE));
  }, [displayIds.length]);

  // ===== 1. Initial Load: Get All IDs =====
  useEffect(() => {
    async function initIds() {
      try {
        const res = await fetch("https://universalis.app/api/v2/marketable");
        if (!res.ok) throw new Error("Failed to fetch marketable IDs");
        const ids: number[] = await res.json();
        setAllMarketableIds(ids);
        setDisplayIds(ids);
      } catch (e) {
        console.error("Init Error:", e);
      }
    }
    initIds();
  }, []);

  // ===== 2. Search Handler =====
  useEffect(() => {
    const handler = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setDisplayIds(allMarketableIds);
        setPage(1);
        return;
      }

      setIsSearching(true);
      try {
        const url = `https://v2.xivapi.com/api/search?q=${encodeURIComponent(
          searchQuery
        )}&domain=Item`;
        const res = await fetch(url);
        const data = await res.json();

        const foundIds = (data.results || [])
          .map((r: any) => r.row_id || r.id)
          .filter((id: any) => typeof id === "number");

        const marketSet = new Set(allMarketableIds);
        const validIds = foundIds.filter((id: number) => marketSet.has(id));

        setDisplayIds(validIds);
        setPage(1);
      } catch (e) {
        console.error("Search Error:", e);
      } finally {
        setIsSearching(false);
      }
    }, 600);

    return () => clearTimeout(handler);
  }, [searchQuery, allMarketableIds]);

  // ===== 3. Main Logic: Fetch Details & Prices for Current Page =====
  const fetchPageData = useCallback(async () => {
    if (displayIds.length === 0) {
      setPageItems([]);
      return;
    }

    setIsPageLoading(true);
    setPriceMap(new Map());

    try {
      const start = (page - 1) * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      const targetIds = displayIds.slice(start, end);

      if (targetIds.length === 0) {
        setPageItems([]);
        return;
      }

      const idStr = targetIds.join(",");
      const itemRes = await fetch(
        `https://v2.xivapi.com/api/sheet/Item?rows=${idStr}&fields=Name,Icon`
      );
      const itemData = await itemRes.json();

      const loadedItems: MarketItem[] = (itemData.rows || []).map(
        (row: any) => ({
          id: row.row_id,
          name: row.fields.Name,
          iconUrl: parseIconUrl(row.fields.Icon),
        })
      );

      setPageItems(loadedItems);

      fetchCurrentPrices(selectedWorld, targetIds);
    } catch (e) {
      console.error("Fetch Page Data Error:", e);
    } finally {
      setIsPageLoading(false);
    }
  }, [displayIds, page, selectedWorld]);

  useEffect(() => {
    fetchPageData();
  }, [fetchPageData]);

  // ===== 4. Price Fetcher (Updated Logic) =====
  async function fetchCurrentPrices(worldOrDc: string, itemIds: number[]) {
    if (!itemIds.length) return;
    setPriceLoading(true);

    try {
      const ids = itemIds.join(",");
      // 注意：worldName 包含在 listings 裡面，所以這裡不需要改 fields
      // 只需要確保抓回 listings 即可
      const fields = [
        "items.itemID",
        "items.lastUploadTime",
        "items.listings.pricePerUnit",
        "items.listings.hq",
        "items.listings.worldName", // 確保 API 回傳 World Name
      ].join(",");
      console.log("Searching for:", worldOrDc);
      const url = `https://universalis.app/api/v2/${encodeURIComponent(
        worldOrDc
      )}/${ids}?listings=${LISTINGS_PER_ITEM}&entries=0&fields=${encodeURIComponent(
        fields
      )}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Universalis Error: ${res.status}`);
      const data = await res.json();

      const entries = normalizeCurrentDataResponse(data);

      const nextMap = new Map<number, PriceInfo>();

      for (const it of entries) {
        const itemId = safeNum(it.itemID || it.itemId || it.item_id);
        if (!itemId) continue;

        const listings = Array.isArray(it.listings) ? it.listings : [];

        // 初始化變數
        let minAll = Infinity,
          minAllW = "";
        let minNQ = Infinity,
          minNQW = "";
        let minHQ = Infinity,
          minHQW = "";

        for (const l of listings) {
          const ppu = safeNum(l.pricePerUnit);
          if (!ppu) continue;
          const wName = l.worldName || ""; // 從 listing 取得伺服器名稱

          // 1. 找全品質最低
          if (ppu < minAll) {
            minAll = ppu;
            minAllW = wName;
          }

          // 2. 分品質比較
          if (l.hq) {
            if (ppu < minHQ) {
              minHQ = ppu;
              minHQW = wName;
            }
          } else {
            if (ppu < minNQ) {
              minNQ = ppu;
              minNQW = wName;
            }
          }
        }

        nextMap.set(itemId, {
          minAll: minAll === Infinity ? 0 : minAll,
          minAllWorld: minAllW,
          minNQ: minNQ === Infinity ? 0 : minNQ,
          minNQWorld: minNQW,
          minHQ: minHQ === Infinity ? 0 : minHQ,
          minHQWorld: minHQW,
          listingsFetched: listings.length,
          lastUploadTime: it.lastUploadTime,
        });
      }
      setPriceMap(nextMap);
    } catch (e) {
      console.error("Price fetch error:", e);
    } finally {
      setPriceLoading(false);
    }
  }

  function normalizeCurrentDataResponse(data: any): any[] {
    if (!data) return [];
    if (data.items) {
      return Array.isArray(data.items)
        ? data.items
        : Object.values(data.items).filter((v) => typeof v === "object");
    }
    if (data.itemID || data.listings) return [data];
    return [];
  }

  // ===== Handlers =====
  function goToPage(p: number) {
    const next = Math.min(Math.max(1, p), totalPages);
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                FFXIV 市場資料庫
              </h1>
              <p className="text-xs text-muted-foreground">陸行鳥區專用版</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring"
                value={selectedWorld}
                onChange={(e) => {
                  setSelectedWorld(e.target.value);
                }}
              >
                <option value="陸行鳥">DC: 陸行鳥 (比價)</option>
                <option disabled>──────────</option>
                {CN_WORLDS.map((w) => (
                  <option key={w.id} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </select>

              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-10"
                  placeholder="搜尋物品 (API)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between mb-6 gap-4 bg-muted/30 p-3 rounded-lg">
          <div className="flex items-center gap-2 text-sm">
            {isSearching && (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
            {!isSearching && (
              <span>
                共 <span className="font-bold">{displayIds.length}</span> 個結果
                {searchQuery && " (搜尋模式)"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="h-8 px-3 rounded border bg-background hover:bg-accent disabled:opacity-50 text-sm"
              disabled={page <= 1 || isPageLoading}
              onClick={() => goToPage(page - 1)}
            >
              上一頁
            </button>
            <span className="text-sm font-mono">
              Page {page} / {totalPages}
            </span>
            <button
              className="h-8 px-3 rounded border bg-background hover:bg-accent disabled:opacity-50 text-sm"
              disabled={page >= totalPages || isPageLoading}
              onClick={() => goToPage(page + 1)}
            >
              下一頁
            </button>
          </div>
        </div>

        {isPageLoading ? (
          <div className="flex flex-col items-center justify-center py-20 min-h-100">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">正在讀取第 {page} 頁資料...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {pageItems.map((item) => {
              const p = priceMap.get(item.id);
              return (
                <MarketItemCard
                  key={item.id}
                  item={item}
                  price={p}
                  gilFmt={gilFmt}
                  loading={priceLoading}
                  selectedWorld={selectedWorld}
                />
              );
            })}
          </div>
        )}

        {!isPageLoading && pageItems.length === 0 && (
          <div className="text-center py-20 border-2 border-dashed rounded-xl">
            <p className="text-muted-foreground text-lg">沒有找到相關物品</p>
          </div>
        )}

        {!isPageLoading && pageItems.length > 0 && (
          <div className="flex justify-center mt-8">
            <div className="flex items-center gap-2">
              <button
                className="h-9 px-4 rounded border bg-background hover:bg-accent disabled:opacity-50"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                上一頁
              </button>
              <button
                className="h-9 px-4 rounded border bg-background hover:bg-accent disabled:opacity-50"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                下一頁
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Sub Component: Card (效能優化與整潔) =====
function MarketItemCard({
  item,
  price,
  gilFmt,
  loading,
  selectedWorld,
}: {
  item: MarketItem;
  price?: PriceInfo;
  gilFmt: Intl.NumberFormat;
  loading: boolean;
  selectedWorld: string;
}) {
  // 判斷是否為跨服 DC 模式 (陸行鳥)
  const isDCMode = selectedWorld === "陸行鳥";

  // 渲染價格的輔助函式
  const renderPriceRow = (
    label: string,
    value: number,
    world?: string,
    className?: string
  ) => {
    const hasPrice = value > 0;
    return (
      <div
        className={`flex justify-between items-baseline text-xs ${className}`}
      >
        <span className="text-muted-foreground shrink-0">{label}</span>
        <div className="text-right overflow-hidden">
          <span
            className={`font-semibold ${
              hasPrice ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {hasPrice ? gilFmt.format(value) : "-"}
          </span>
          {/* 如果是 DC 模式且有價格，顯示伺服器名稱 */}
          {isDCMode && hasPrice && world && (
            <span className="ml-1 text-[10px] text-muted-foreground bg-secondary px-1 py-0.5 rounded">
              {world}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className="group overflow-hidden hover:shadow-lg transition-all duration-200 hover:border-primary/50">
      <div className="p-3">
        {/* Header: Icon + Name */}
        <div className="flex items-start gap-3 mb-3">
          <div className="relative w-12 h-12 shrink-0 rounded bg-secondary overflow-hidden border border-border">
            <img
              src={item.iconUrl}
              alt={item.name}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/placeholder.svg";
              }}
            />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm text-foreground line-clamp-2 leading-tight">
              {item.name}
            </h3>
            <p className="text-[10px] text-muted-foreground mt-1 font-mono">
              ID: {item.id}
            </p>
          </div>
        </div>

        {/* Price Info */}
        <div className="bg-muted/50 rounded p-2 space-y-1.5">
          {/* 1. NQ 價格 */}
          {renderPriceRow(
            "NQ",
            price?.minNQ ?? 0,
            price?.minNQWorld,
            price && price.minNQ > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : ""
          )}

          {/* 2. HQ 價格 */}
          {renderPriceRow(
            "HQ",
            price?.minHQ ?? 0,
            price?.minHQWorld,
            "text-amber-600 dark:text-amber-400"
          )}

          {/* Footer Info */}
          <div className="pt-2 mt-1 border-t border-border/50 flex justify-between items-center text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              {isDCMode ? <Globe className="h-3 w-3" /> : null}
              {price ? `庫存: ${price.listingsFetched}` : "讀取中..."}
            </span>
            {loading && !price && <Loader2 className="h-3 w-3 animate-spin" />}
          </div>
        </div>
      </div>
    </Card>
  );
}
