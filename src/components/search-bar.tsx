"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchResult {
  type: "node" | "company";
  nodeId: string;
  name: string;
  detail?: string;
}

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  results: SearchResult[];
  onResultClick: (nodeId: string) => void;
  onClear: () => void;
  activeNodeTypes: Set<string>;
  onToggleNodeType: (nodeType: string) => void;
}

const NODE_TYPE_OPTIONS = [
  { value: "UPSTREAM", label: "上游", color: "bg-red-100 text-red-600 border-red-300", inactiveColor: "bg-white text-gray-500 border-gray-300" },
  { value: "MIDSTREAM", label: "中游", color: "bg-yellow-100 text-yellow-700 border-yellow-300", inactiveColor: "bg-white text-gray-500 border-gray-300" },
  { value: "DOWNSTREAM", label: "下游", color: "bg-green-100 text-green-700 border-green-300", inactiveColor: "bg-white text-gray-500 border-gray-300" },
];

export function SearchBar({
  query,
  onQueryChange,
  results,
  onResultClick,
  onClear,
  activeNodeTypes,
  onToggleNodeType,
}: SearchBarProps) {
  const [showResults, setShowResults] = useState(false);

  return (
    <div className="absolute left-4 top-4 z-10 w-72">
      <div className="relative">
        <Input
          placeholder="搜索环节或公司..."
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => setShowResults(true)}
          className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 pr-8 shadow-sm"
        />
        {query && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
            onClick={() => {
              onClear();
              setShowResults(false);
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Filter pills */}
      <div className="mt-2 flex gap-1">
        {NODE_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors border ${
              activeNodeTypes.has(opt.value)
                ? opt.color
                : opt.inactiveColor
            }`}
            onClick={() => onToggleNodeType(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Search results dropdown */}
      {showResults && results.length > 0 && (
        <div className="mt-1 max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg shadow-black/10">
          {results.map((result, i) => (
            <button
              key={`${result.nodeId}-${i}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 text-gray-900"
              onClick={() => {
                onResultClick(result.nodeId);
                setShowResults(false);
              }}
            >
              <span
                className={`text-xs ${
                  result.type === "company" ? "text-[#C59D5F]" : "text-gray-400"
                }`}
              >
                {result.type === "company" ? "公司" : "环节"}
              </span>
              <span className="flex-1 truncate font-medium">{result.name}</span>
              {result.detail && (
                <span className="text-xs text-gray-400">{result.detail}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
