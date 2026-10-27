const COLORS = [
  "#171727",
  "#ffffff",
  "#ff5d8f",
  "#ff9f43",
  "#ffd166",
  "#5ee7a8",
  "#4cc9f0",
  "#8c7bff",
  "#c77dff",
  "#8d5b3e"
];
function DrawingToolbar({
  canDraw,
  color,
  width,
  tool,
  canUndo,
  canRedo,
  onColorChange,
  onWidthChange,
  onToolChange,
  onUndo,
  onRedo,
  onClear
}) {
  return <div className={`draw-toolbar ${!canDraw ? "draw-toolbar--disabled" : ""}`} aria-label="Drawing tools">
      <div className="draw-toolbar__group draw-toolbar__colors" role="group" aria-label="Brush colour">
        {COLORS.map((swatch) => <button
    key={swatch}
    type="button"
    className={`color-swatch ${color === swatch && tool === "pen" ? "color-swatch--active" : ""} ${swatch === "#ffffff" ? "color-swatch--light" : ""}`}
    style={{ backgroundColor: swatch }}
    onClick={() => {
      onColorChange(swatch);
      onToolChange("pen");
    }}
    disabled={!canDraw}
    aria-label={`Use colour ${swatch}`}
    aria-pressed={color === swatch && tool === "pen"}
  />)}
        <label className="custom-color" aria-label="Custom brush colour">
          <input
    type="color"
    value={color}
    onChange={(event) => {
      onColorChange(event.target.value);
      onToolChange("pen");
    }}
    disabled={!canDraw}
  />
          <span aria-hidden="true">+</span>
        </label>
      </div>

      <div className="draw-toolbar__group draw-toolbar__sizes" role="group" aria-label="Brush size">
        {[2, 5, 10, 18].map((size) => <button
    key={size}
    type="button"
    className={`size-button ${width === size && tool === "pen" ? "size-button--active" : ""}`}
    onClick={() => {
      onWidthChange(size);
      onToolChange("pen");
    }}
    disabled={!canDraw}
    aria-label={`Brush size ${size}`}
    aria-pressed={width === size && tool === "pen"}
  >
            <span
    className="size-button__dot"
    style={{ width: `${Math.min(18, size + 2)}px`, height: `${Math.min(18, size + 2)}px` }}
  />
          </button>)}
      </div>

      <div className="draw-toolbar__group" role="group" aria-label="Drawing actions">
        <button
    type="button"
    className={`tool-button ${tool === "eraser" ? "tool-button--active" : ""}`}
    onClick={() => onToolChange(tool === "eraser" ? "pen" : "eraser")}
    disabled={!canDraw}
    aria-pressed={tool === "eraser"}
    title="Eraser (E)"
  >
          <span aria-hidden="true">⌫</span> Eraser
        </button>
        <button
    type="button"
    className="icon-button tool-icon"
    onClick={onUndo}
    disabled={!canDraw || !canUndo}
    aria-label="Undo last stroke"
    title="Undo"
  >
          <span aria-hidden="true">↶</span>
        </button>
        <button
    type="button"
    className="icon-button tool-icon"
    onClick={onRedo}
    disabled={!canDraw || !canRedo}
    aria-label="Redo stroke"
    title="Redo"
  >
          <span aria-hidden="true">↷</span>
        </button>
        <button
    type="button"
    className="tool-button tool-button--danger"
    onClick={onClear}
    disabled={!canDraw}
    title="Clear canvas"
  >
          Clear
        </button>
      </div>
    </div>;
}
export {
  DrawingToolbar
};
