import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

/**
 * DashboardGrid - A react-grid-layout wrapper for drag/drop/resize widgets.
 *
 * Props:
 *  - layout: array of {i, x, y, w, h} items
 *  - onLayoutChange: callback when layout changes
 *  - children: widget elements (must have key matching layout.i)
 *  - cols: column count (default 12)
 *  - rowHeight: pixel height per row unit (default 60)
 *  - isDraggable / isResizable: enable/disable editing
 */
export default function DashboardGrid({
  layout,
  onLayoutChange,
  children,
  cols = 12,
  rowHeight = 60,
  isDraggable = true,
  isResizable = true,
}) {
  const breakpoints = { lg: 1200, md: 996, sm: 768, xs: 480 };
  const colsMap = { lg: cols, md: Math.max(cols - 2, 6), sm: 4, xs: 2 };

  return (
    <ResponsiveGridLayout
      className="dashboard-grid"
      layouts={{ lg: layout }}
      breakpoints={breakpoints}
      cols={colsMap}
      rowHeight={rowHeight}
      isDraggable={isDraggable}
      isResizable={isResizable}
      onLayoutChange={(currentLayout) => onLayoutChange(currentLayout)}
      draggableHandle=".widget-drag-handle"
      compactType="vertical"
      margin={[8, 8]}
    >
      {children}
    </ResponsiveGridLayout>
  );
}
