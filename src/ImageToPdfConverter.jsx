import { useState, useRef, useCallback } from "react";
import { jsPDF } from "jspdf";
import styles from "./ImageToPdfConverter.module.css";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a MIME type (or file extension) to the format string jsPDF expects. */
function resolveImageFormat(file) {
  const mime = file.type.toLowerCase();
  if (mime === "image/png") return "PNG";
  if (mime === "image/webp") return "WEBP";
  // JPEG / JPG both map to "JPEG"
  return "JPEG";
}

/** Load a File into a base64 data‑URL via FileReader. */
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Build an HTMLImageElement from a data‑URL so we can read natural dimensions. */
function loadImage(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = dataURL;
  });
}

/**
 * Compress an image for PDF embedding:
 *  1. Cap resolution to A4 @ 150 DPI (1754 × 1240 px landscape) — enough for
 *     crisp print output while drastically shrinking file size.
 *  2. Fill transparent areas with white (PNG alpha → JPEG safe).
 *  3. Re-encode as JPEG at 0.85 quality.
 *
 * Returns { dataURL, format, width, height } ready for doc.addImage().
 */
function compressImage(imgEl, maxW = 1754, maxH = 1240, quality = 0.85) {
  const { naturalWidth: nw, naturalHeight: nh } = imgEl;

  // Scale down only — never upscale
  const scale = Math.min(maxW / nw, maxH / nh, 1);
  const canvasW = Math.round(nw * scale);
  const canvasH = Math.round(nh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;

  const ctx = canvas.getContext("2d");
  // White background so transparent PNGs don't turn black in JPEG
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.drawImage(imgEl, 0, 0, canvasW, canvasH);

  return {
    dataURL: canvas.toDataURL("image/jpeg", quality),
    format: "JPEG",
    width: canvasW,
    height: canvasH,
  };
}

// A4 page dimensions in mm (landscape)
const A4_WIDTH_MM = 297;
const A4_HEIGHT_MM = 210;
const MARGIN_MM = 10;
const CONTENT_WIDTH = A4_WIDTH_MM - MARGIN_MM * 2;
const CONTENT_HEIGHT = A4_HEIGHT_MM - MARGIN_MM * 2;

/** Scale image dimensions to fit within the printable content area. */
function fitToDimensions(imgWidth, imgHeight) {
  const scaleX = CONTENT_WIDTH / imgWidth;
  const scaleY = CONTENT_HEIGHT / imgHeight;
  const scale = Math.min(scaleX, scaleY, 1); // never upscale
  return { w: imgWidth * scale, h: imgHeight * scale };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ImageToPdfConverter() {
  const [images, setImages] = useState([]); // { id, file, dataURL, name }
  const [isDragOver, setIsDragOver] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  // ------------------------------------------------------------------
  // File ingestion
  // ------------------------------------------------------------------

  const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

  const processFiles = useCallback((files) => {
    setError(null);
    const valid = Array.from(files).filter((f) => ACCEPTED_TYPES.includes(f.type));
    if (valid.length === 0) {
      setError("Please upload PNG, JPG/JPEG, or WebP images only.");
      return;
    }

    Promise.all(
      valid.map(async (file) => {
        const dataURL = await readFileAsDataURL(file);
        return {
          id: `${file.name}-${file.lastModified}-${Math.random()}`,
          file,
          dataURL,
          name: file.name,
        };
      })
    ).then((newImages) => {
      setImages((prev) => [...prev, ...newImages]);
    });
  }, []);

  const handleFileInputChange = (e) => processFiles(e.target.files);

  // Drag & drop
  const handleDragOver = (e) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    processFiles(e.dataTransfer.files);
  };

  // ------------------------------------------------------------------
  // Remove single image
  // ------------------------------------------------------------------

  const removeImage = (id) =>
    setImages((prev) => prev.filter((img) => img.id !== id));

  // ------------------------------------------------------------------
  // PDF generation
  // ------------------------------------------------------------------

  const generatePDF = async () => {
    if (images.length === 0) return;
    setIsGenerating(true);
    setError(null);

    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      for (let i = 0; i < images.length; i++) {
        const { dataURL, file } = images[i];

        // Decode to get natural pixel dimensions
        const imgEl = await loadImage(dataURL);

        // Compress: resize to A4@150dpi max, re-encode as JPEG 0.85
        const compressed = compressImage(imgEl);

        // Scale compressed pixel dims to mm for the PDF page
        const { w, h } = fitToDimensions(compressed.width, compressed.height);

        // Centre the image on the page
        const x = MARGIN_MM + (CONTENT_WIDTH - w) / 2;
        const y = MARGIN_MM + (CONTENT_HEIGHT - h) / 2;

        doc.addImage(compressed.dataURL, compressed.format, x, y, w, h);

        // Add a new page for every image except the last
        if (i < images.length - 1) doc.addPage();
      }

      doc.save("converted-documents.pdf");
    } catch (err) {
      setError(`PDF generation failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className={styles.wrapper}>
      {/* ── Header ── */}
      <header className={styles.header}>
       
        <h1 className={styles.title}>Image to PDF Converter</h1>
        <p className={styles.subtitle}>
          Convert PNG, JPG, JPEG &amp; WebP images into a single PDF document — entirely in your browser.
        </p>
      </header>

      {/* ── Drop Zone ── */}
      <div
        className={`${styles.dropzone} ${isDragOver ? styles.dropzoneActive : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
        aria-label="Upload images"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          multiple
          onChange={handleFileInputChange}
          className={styles.hiddenInput}
          aria-hidden="true"
        />
        <div className={styles.dropzoneIcon}>📁</div>
        <p className={styles.dropzoneText}>
          <strong>Click to browse</strong> or drag &amp; drop images here
        </p>
        <p className={styles.dropzoneHint}>Supports PNG · JPG · JPEG · WebP</p>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className={styles.errorBanner} role="alert">
          ⚠️ {error}
        </div>
      )}

      {/* ── Preview Grid ── */}
      {images.length > 0 && (
        <section className={styles.previewSection}>
          <div className={styles.previewHeader}>
            <h2 className={styles.previewTitle}>
              {images.length} image{images.length !== 1 ? "s" : ""} queued
            </h2>
            <button
              className={styles.clearAllBtn}
              onClick={() => setImages([])}
              aria-label="Clear all images"
            >
              Clear all
            </button>
          </div>

          <ul className={styles.grid} aria-label="Image queue">
            {images.map((img) => (
              <li key={img.id} className={styles.card}>
                <div className={styles.thumbnailWrap}>
                  <img
                    src={img.dataURL}
                    alt={img.name}
                    className={styles.thumbnail}
                    loading="lazy"
                  />
                </div>
                <div className={styles.cardBody}>
                  <span className={styles.filename} title={img.name}>
                    {img.name}
                  </span>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeImage(img.id)}
                    aria-label={`Remove ${img.name}`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* ── Download Button ── */}
          <div className={styles.actions}>
            <button
              className={`${styles.downloadBtn} ${isGenerating ? styles.downloadBtnLoading : ""}`}
              onClick={generatePDF}
              disabled={isGenerating || images.length === 0}
              aria-busy={isGenerating}
            >
              {isGenerating ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  Generating PDF…
                </>
              ) : (
                <>
                  ⬇️&nbsp; Download PDF
                </>
              )}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

