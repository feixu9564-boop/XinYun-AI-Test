# Normal records spectral summary (0.6.3-rc)

This logging-only addition exports POS and CHROM spectral summaries in normal JSON records and CSV, without requiring diagnostic mode. Status remains **DEVICE_TEST_REQUIRED**; synthetic regression checks do not establish real-device accuracy.

The appended fields for each method (`pos_` / `chrom_`) are `peak_bpm`, `concentration`, `secondary_ratio`, `secondary_bpm`, `subharmonic_ratio`, and `subharmonic_bpm`. Peak BPM is the candidate spectral peak even when a quality gate rejects it. Secondary BPM identifies the strongest bin outside the main lobe; subharmonic BPM identifies the strongest bin in the existing half-frequency set. Ratios and concentration use the existing spectral calculations.

Shared fields are `spectral_bin_bpm` (frequency-bin spacing in BPM), `analysis_sample_count`, `analysis_fs` (Hz), and `analysis_duration` (seconds). Values not evaluated are null in JSON and empty cells in CSV. Partial windows retain available spectral summaries while keeping their existing failed decision and null output BPM values.

Decision logic, thresholds, gate order, reasons, output BPM and quality, UI text and behavior, privacy, and version strings are unchanged. No images, video, or landmarks are added to records.
