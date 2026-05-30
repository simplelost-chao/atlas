"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CommentInputProps {
  onSubmit: (content: string) => void;
  loading?: boolean;
}

export function CommentInput({ onSubmit, loading }: CommentInputProps) {
  const [content, setContent] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    onSubmit(content.trim());
    setContent("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="添加评论..."
        disabled={loading}
        className="flex-1"
      />
      <Button type="submit" size="sm" disabled={!content.trim() || loading}>
        发送
      </Button>
    </form>
  );
}
