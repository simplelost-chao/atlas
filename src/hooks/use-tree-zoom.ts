"use client";

import { useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";

interface UseTreeZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  initialTransform?: d3.ZoomTransform;
}

export function useTreeZoom(options: UseTreeZoomOptions = {}) {
  const { minZoom = 0.1, maxZoom = 3 } = options;

  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | undefined>(undefined);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([minZoom, maxZoom])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr("transform", event.transform.toString());
        transformRef.current = event.transform;
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    return () => {
      svg.on(".zoom", null);
    };
  }, [minZoom, maxZoom]);

  const zoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(300).call(zoomRef.current.scaleBy, 1.3);
  }, []);

  const zoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(300).call(zoomRef.current.scaleBy, 0.7);
  }, []);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  const fitToScreen = useCallback(() => {
    if (!svgRef.current || !gRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    const bounds = gRef.current.getBBox();
    const svgRect = svgRef.current.getBoundingClientRect();

    const fullWidth = svgRect.width;
    const fullHeight = svgRect.height;

    const scale =
      0.9 *
      Math.min(
        fullWidth / (bounds.width || 1),
        fullHeight / (bounds.height || 1)
      );

    const tx = fullWidth / 2 - scale * (bounds.x + bounds.width / 2);
    const ty = fullHeight / 2 - scale * (bounds.y + bounds.height / 2);

    svg
      .transition()
      .duration(500)
      .call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
  }, []);

  /** Center view on a specific SVG coordinate at current scale */
  const centerOnPoint = useCallback((x: number, y: number) => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    const svgRect = svgRef.current.getBoundingClientRect();
    const currentScale = transformRef.current.k;

    const tx = svgRect.width / 2 - x * currentScale;
    const ty = svgRect.height / 2 - y * currentScale;

    svg
      .transition()
      .duration(400)
      .call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(tx, ty).scale(currentScale)
      );
  }, []);

  const centerAt1to1 = useCallback(() => {
    if (!svgRef.current || !gRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    const bounds = gRef.current.getBBox();
    const svgRect = svgRef.current.getBoundingClientRect();

    const tx = svgRect.width / 2 - (bounds.x + bounds.width / 2);
    const ty = svgRect.height / 2 - (bounds.y + bounds.height / 2);

    svg
      .transition()
      .duration(400)
      .call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(tx, ty)
      );
  }, []);

  return {
    svgRef,
    gRef,
    zoomIn,
    zoomOut,
    resetZoom,
    fitToScreen,
    centerAt1to1,
    centerOnPoint,
    transformRef,
  };
}
