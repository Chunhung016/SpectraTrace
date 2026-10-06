# SpectraTrace — local research data bank

Open **http://127.0.0.1:4174** while the local server is running. The earlier static demonstration at port 4173 and the hosted site are unchanged; the persistent bank is a separate local version. Do not upload private research files to the old demonstration expecting persistence.

## Start again

Requires Node.js 24 or newer. In this folder:

```powershell
npm install
npm start
```

The server binds only to `127.0.0.1`. Keep the terminal running. To stop, press Ctrl+C. To use a different port, set `$env:PORT = '4175'` before starting. The default data folder is `data/`; set `SPECTRATRACE_DATA_DIR` before starting only if deliberately relocating storage. Do not run two servers against the same data folder.

## First start from GitHub

Requires Node.js 24 or newer and Git:

```powershell
git clone https://github.com/Chunhung016/SpectraTrace.git
cd SpectraTrace
npm ci
npm run build:logic
npm run build:simulations
npm start
```

Open **http://127.0.0.1:4174**. Run the two build commands before starting the server; on later starts, use just `npm start`. The source checkout includes the attributed identity catalog, not a research database or downloaded experimental spectra. These commands create a new local bank and the T teaching records. Research uploads, databases, backups, exports, import reports and large rebuildable dataset files are excluded from Git. Source-specific catalog licenses described below still apply; this repository does not grant a blanket license over third-party data. GitHub stores the source code; it does not run this local Node.js application.

## NMR coupling and solvent controls

Both NMR windows now have a compact **NMR** menu: observed-nucleus frequency in MHz, solvent tick choices, water/zero-reference guides, two-line spacing measurement and signal/reference focus. Focus changes the x-range, not peak coordinates. Typical proton and carbon frequencies are separate; a 400 MHz proton instrument does not mean a 400 MHz carbon frequency. The carbon T view is **¹³C{¹H}**, proton-decoupled; compound singlets must not be arbitrarily split by attached protons.

The rebuilt T dataset contains `first-order-teaching-v1` models for all 1,461 unique structures / 1,500 collection memberships. Local graph refinement groups illustrative sites; authored shift heuristics and vicinal/aromatic-meta J defaults produce first-order lines. Pascal ratios apply to spin-½ partners; deuterium uses spin-1 convolution, so carbon CDCl₃ is a 1:1:1 triplet and DMSO-d₆ carbon is a 1:3:6:7:6:3:1 septet. Line spacing is J / observed MHz in ppm. Split lines are analytical positions rather than grid-rounded locations. Rebuild using `npm run build:simulations`.

**This is not a validated chemical-shift or coupling predictor.** T δ/J values are teaching assumptions. Graph classes are not guaranteed magnetic equivalence; diastereotopic CH₂, geminal, most long-range and heteronuclear coupling, isotope shifts, stereochemical and second-order effects remain unmodelled. Coincident/strong-coupling warnings are shown. Exchange-sensitive H has optional placeholder positions. Changing the selected solvent adds reference peaks/guides; it does not calculate solvent-dependent compound shifts. Carbon heights are not quantitative integrals.

Residual-solvent shifts and approximate H–D/C–D J references link to [MilliporeSigma impurity shifts](https://www.sigmaaldrich.com/US/en/technical-documents/technical-article/analytical-chemistry/nuclear-magnetic-resonance/1h-nmr-and-13c-nmr-chemical-shifts-of-impurities-chart) and [solvent coupling data](https://www.sigmaaldrich.com/US/en/technical-documents/technical-article/analytical-chemistry/nuclear-magnetic-resonance/nmr-deuterated-solvent-properties-reference). Water positions are approximate and optional. D₂O has no carbon solvent peak. Orange T solvent lines have assumed heights; orange dashed guides on measurements do **not** assert that an observed line is solvent. The two-line tool reports Δν = |δ₁−δ₂| × MHz, not an automatically confirmed J assignment.

NMR CSV exports preserve the original measured numerical trace or reported position/multiplicity/coupling list even when the display uses detected sticks. T CSV includes line origins, signal IDs, multiplicity and assumed J values, with solvent/reference origins separate. Exports record frequency, selected solvent, guides and T limitations. No references, guides or T records enter experimental matching.

## Student FTIR workflow (October 2026)

The landing page remains the name, search and upload action. Upload opens a clean condition form with **tick-box choices**, not acquisition dropdowns: physical state, ATR/transmission/reflectance mode, solvent, vertical-axis convention and expected single compound versus mixture. Unknown conditions are allowed and explicitly limit matching. Additional fields cover instrument, resolution, scans, temperature, background, processing and preparation notes. Conditions are saved with the measurement.

Multi-trace numerical CSV/TXT files are supported. Choose one intensity column explicitly; the original file retains all columns unchanged. For a three-column FTIR export with original and normalized %T columns, the first/original trace is the default. Normalized data is flagged; transforming it with −log10(T/100) does not turn it into quantitative measured absorbance.

The analysis page separates two results:

- **Measured-reference matches:** compatible, approved experimental submissions only. No matches are fabricated when references or acquisition conditions are missing.
- **Structure suggestions:** unvalidated interval-based functional-group screening of the starter catalog. Analysis uses a median-filtered copy, prominent local absorption extrema, a 400–4000 cm⁻¹ screening window and flags suspected CO₂-region/narrow spikes. Raw points are never filtered or replaced. Fingerprint extrema below 1500 cm⁻¹ are listed, but no exact fingerprint identity is inferred from structural rules. Candidates are ordered by supported clues, with a small cautionary penalty for an expected carbonyl not clearly detected; ties are alphabetical. Missing bands are not definitive exclusions. The broad catalog list is paginated and can be filtered by name/formula. No score is a probability, and this is not an exhaustive list of all compounds in the world.

Selecting a candidate saves a **student hypothesis** in `student_selections`. The sample stays unknown, its `compound_id` stays NULL, and it never becomes an approved reference. “None of these / keep unknown” clears the hypothesis. Screen 2 shows the source structure, name, subscripted formula and technique buttons, with a small hypothesis marker and a return link. Candidate-associated NMR/UV data is not evidence measured on the unknown. The student’s uploaded spectrum is selectable separately as “Your upload · unknown sample.”

The renderer adds x/y whitespace and an adjustable x-range. Peak coordinates are never shifted to manufacture separation. Display reduction preserves local extrema; CSV exports retain all selected-trace rows even if the graph is zoomed. NMR remains vertical sticks. FTIR supports downward %T and upward A when physically appropriate; reflectance and n/k cannot be converted that way. The UI label for generated illustrations is **T**. Optional fixed-seed instrument texture adds small baseline ripple, noise and isolated spikes to T FTIR/UV views only. The recipe is identical across structures and never adds compound-specific fingerprint evidence. Texture, T provenance and student-hypothesis status are retained in exports. These effects are not a validated instrument model or an experimental prediction. Measured curves and stored T datasets are unchanged.

**XRD, fluorescence and Raman** accept measured numerical uploads, initially alongside FTIR or with the `+` button on a selected sample’s spectrum window. XRD uses 2θ in degrees, fluorescence wavelength in nm and Raman shift in cm⁻¹. XRD radiation/wavelength and polymorph, and fluorescence excitation/solvent, are relevant metadata. No powder diffraction pattern, emission maximum or microscopy morphology is fabricated from SMILES. A molecular formula/structure is insufficient to determine crystal packing, polymorph, crystallite size, instrumental broadening or fluorescence conditions.

**SEM/TEM:** clicking the microscopy button searches the official [Europe PMC REST API](https://europepmc.org/RestfulWebService) for up to 12 open-access papers per compound. Only the catalog compound name leaves this computer; uploaded spectra never leave it. Figure discovery requires an explicit CC BY license, an SEM/TEM caption referring to the compound or a registered acetaminophen/paracetamol alias, and an advertised PMC image CDN reference. Retracted records and explicit third-party reproduced figures are excluded. Literature figures can still depict formulations, co-crystals or treated samples: captions, authors, year, paper links and license links remain visible, and exact sample identity is not certified. Published figure pixels are embedded unaltered from PMC, not downloaded as private sample evidence or used for matching. Figure URLs/citations are cached locally in `microscopy_searches` for 24 hours; images are not mirrored. Discovery is neither an exhaustive literature search nor complete microscopy coverage of all 1,461 structures. Known starting papers include [aspirin crystal nanoindentation (2020)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7587144/) and [paracetamol particles/solid dispersions (2021)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8076289/).

Functional-group screening references: [MSU infrared teaching resource](https://www2.chemistry.msu.edu/faculty/reusch/virttxtjml/spectrpy/infrared/irspec1.htm) and [Thermo Fisher ATR identification workflow](https://knowledge1.thermofisher.com/Molecular_Spectroscopy/Molecular_Spectroscopy_Software/OMNIC_Family/OMNIC_Paradigm_Software/OMNIC_Paradigm_Operator_Manuals/Latest_OMNIC_Paradigm_User_Guide/Identify_an_Unknown_Sample_with_ATR). Rules are independently authored educational heuristics, not copied source spectra or validated identification claims.

Storage migrations 5–6 are additive: extra techniques go into `auxiliary_spectra`; original spectral tables/files are not rebuilt. Hypotheses and microscopy citation caches are separate from reference approvals. Backups include these tables and additional original uploads. Automated tests cover multi-column selection, suspect artifacts, T-only reproducible texture, axis padding, CC BY/retraction filtering, hypothesis isolation, additional uploads, no-overwrite behavior and backup/restart persistence.

## Starter identity selection

The checked-in [catalog/identities.json](catalog/identities.json) contains **1,500 source-backed collection memberships, 1,461 distinct InChIKeys**:

- 500 microbial natural products: first 500 unique identities in NPAtlas v2024_09 TSV order. This is not a plant-natural-products or representative diversity collection. Identity publications and DOI links are retained where provided. Data license: **CC BY-NC 4.0**; noncommercial use and attribution required. [NPAtlas source and terms](https://www.npatlas.org/download).
- 500 pharmaceutical identities: first 500 unique, named, structure-bearing small-molecule parents returned by ChEMBL with `max_phase=4`. Includes historical compounds; this field does not certify current approval, safety or availability. **CC BY-SA 3.0**. [ChEMBL documentation and terms](https://chembl.gitbook.io/chembl-interface-documentation/frequently-asked-questions/general-questions).
- 500 aromatic synthesis identities: **167 amides, 167 esters, 166 carboxylic acids** selected through PubChem benzene-carbonyl substructure queries. Overlaps within this collection assigned to the first family. Broader heteroaromatic or ring-nitrogen-bound amides are not covered by these queries. Ordering is not a scientific diversity or sourcing ranking. PubChem source-specific attribution and usage terms apply; do not infer one blanket license. [PubChem data-source guidance](https://pubchem.ncbi.nlm.nih.gov/docs/data-sources).

An identity shared between collections has one compound record with multiple source memberships. The **exact imported selection, SMILES, formula, source identifier, source URL, license note and retrieval timestamp** are retained in the catalog. Molecular diagrams are rendered from these SMILES locally by pinned RDKit.js 2026.9.1 (BSD-3-Clause). No external structure lookup is needed during use.

The identity catalog alone contains **zero experimental spectra at initialization**. The separate internet evidence import described below now supplements it. It is not a verified 1,500-spectrum library. Missing reviewed FTIR, ¹H NMR, ¹³C NMR and UV–Vis remain explicit. A separate, clearly labelled **T** simulation is available for every catalog structure; it never becomes experimental evidence or an identification-confidence percentage.

## Public spectral evidence import

Open **Imported evidence** at `http://127.0.0.1:4174/#evidence`. The local SQLite bank retains structure-linked evidence from these public sources, supplemented by the selective NIST import below; original files, dataset retrieval timestamps, licenses and SHA-256 hashes are preserved. Exact InChIKey joins connect matching identities to the 500-per-collection starter catalog. Other source identities remain searchable in the external pool; they do not change the collection selections. Cross-technique links represent **separate experiments**, not one physical sample.

- [Chemotion IR collection](https://doi.org/10.22000/OGoEQGlsZGElrgst): 4,183 original JCAMP files. Full numerical traces are decoded with pinned MIT-licensed `jcampconverter@9.0.0`; header units, point count and range are checked. Peak tables and unreadable files are separate. Duplicate numerical curves are flagged, not treated as additional independent measurements. CC BY-SA 4.0, record-level authors retained.
- [UV-adVISor publication](https://doi.org/10.1021/acs.analchem.1c03741) and [author Figshare deposit](https://figshare.com/articles/dataset/UV-adVISor_Attention-Based_Recurrent_Neural_Networks_to_Predict_UV-Vis_Spectra/15217512): actual experimental datasets I and II only, **source-baseline-corrected and maximum-normalized**, not raw instrument absorbance. HPLC-DAD dataset I has 950 deposited rows (paper reports 949); dataset II has 2,222 rows. Preserve this discrepancy and exact-curve duplicate flags. Predictions, scrambled structures and dataset III are excluded. Dataset II’s printed concentration conflicts with its stock/dilution calculation; verify the experimental protocol before use. Deposit CC BY 4.0; archive MD5 matches author deposit.
- [NP-MRD experimental exports](https://np-mrd.org/downloads): 1,685 original assignment files and 871 peak-list files. Separate ¹H/¹³C **assigned chemical shifts / unassigned positions**, not full intensity spectra, FIDs or fabricated equal-intensity sticks. Missing/ambiguous shifts remain explicit. Downloaded identity metadata covers NP0000001–NP0050000; unresolved later accessions are retained without guessed structures. **CC BY-NC 4.0**, noncommercial research/education only.
- [IRexp](https://huggingface.co/datasets/ilkhamfy/IRexp): 29,255 literature-mined, structure-linked IR band records plus separately retained reported ¹H/¹³C text where provided. These are **not raw spectra** and the collection’s manuscript is in preparation, not a validated curated reference. Suspected/shared band lists and identity inconsistencies are quarantined. Packaging CC BY 4.0; original per-record source license, PMC/DOI links and license notices retained.

All imported evidence is **excluded from automatic unknown matching pending independent identity/data/conditions review**. No paid API or synthetic spectral prediction was used. Numerical assignments without intensities cannot be compared as full traces by the current matching algorithm. To use independently checked source data as a reviewed reference, export a compatible numerical trace, submit it through Add reference with source attribution and actual acquisition metadata, then perform the normal review. Never invent missing instrument conditions.

The authoritative inventory and parse exceptions are saved in `spectra-import-report.json`. Source archives and their provenance are in `data/source-downloads/`. Idempotent import commands (no spectrum deletion, no identity reselection):

```powershell
npm run acquire:spectra
npm run extract:spectra
npm run import:spectra
```

Downloads are cached rather than automatically refreshed. Re-running the importer re-derives only external evidence metadata; it does not modify researcher samples/reviews. Keep archive provenance with originals. Source code is not automatically relicensed. Additional nmrshiftdb2 bulk integration remains deferred because its extended ODbL includes software open-source requirements that need the owner’s licensing decision. Commercial NIST collections and sources without clear redistribution terms were not bulk imported. This search is a substantial first collection, not every available spectrum on the internet.

`npm run import:catalog` re-fetches the external APIs without an API key, generating a new catalog snapshot; future source ordering may change. Normal `npm start` does **not** re-fetch. Startup inserts missing identities/memberships without overwriting existing records. For deliberate catalog replacement, make a backup and plan a separate migration; re-importing is not a reset operation.

## Selective NIST / PNNL experimental reference import

`npm run import:nist` discovers catalog-name candidates in the official [solid reflectance](https://webbook.nist.gov/chemistry/silmarils-solids-hrf-drf/) and [liquid optical-constant](https://webbook.nist.gov/chemistry/silmarils-liquids-n-k/) collections. It downloads only advertised JCAMP links when the individual spectrum page **and every decoded JCAMP block** explicitly say `Owner: Public domain`. The NIST SRD 69 compilation remains copyrighted; this is not a whole-WebBook mirror or permission to redistribute other NIST collections. NIST/Coblentz copyrighted spectra and unavailable H/C NMR remain outside this import. Broader SRD use requires clarification with NIST. No AI service or training use is involved.

First batch: **7 original PNNL files, 14 numerical reflectance traces, 7 exact-linked catalog identities**: benzamide, benzoic acid, phenolphthalein, caffeine, melatonin, acetaminophen and dimethyl terephthalate. Each original contains total and diffuse-only reflectance from the same measurement set; these are **not 14 independent sample experiments**. Three other name candidates were skipped because their full InChIKeys differed. Neither partial-key matching nor guessed stereochemistry is used. Name discovery is deliberately conservative and may miss synonyms; this is not an exhaustive availability audit of all 1,500 entries. No matching liquid optical-constant identities were found by this discovery pass. The report `nist-import-report.json` records actual counts, imports, skipped identities and exceptions for each run.

Identity linking requires exact full InChIKey, agreement with independent RDKit hashing of the page's InChI, and a JCAMP CAS matching that page. Numerical decoding checks units, point count, finite values and endpoint range for every block. Original JCAMP bytes and retrieval provenance/checksums are stored under `data/source-downloads/nist-public-domain/` and included in existing backups. Parsed page/index metadata and their retrieval hashes are retained, **not full original HTML**, so their extraction cannot be replayed offline from the hashes alone. Saved JCAMP originals can be independently re-decoded and ownership-checked. Requests respect a minimum 5-second crawl delay, stop on rate-limit/service-unavailable responses, and use cached originals on reruns. Existing quarantines are preserved; numerical duplicates have one stable canonical record.

The compound viewer offers `NIST · PNNL` in the FTIR source selector. The y-axis preserves **Hemispherical (Total) reflectance** or **Diffuse-only reflectance**, without percentage scaling, normalization, resampling, absorbance conversion or fabricated peaks. Reflectance and optical constants do not expose A/%T conversion or tentative absorbance-based functional-group assignment. Conventional measured spectra rank first if available; these reference observables remain separate from them and from **T**. PNG/JPEG/CSV exports carry physical quantity, source link, measurement conditions, rights and citation. Imports are **unreviewed and excluded from unknown-compound matching**; researcher samples and review decisions are unchanged.

An optional targeted rerun is `npm run import:nist -- --compound="Benzoic acid"`. It uses the same identity/ownership checks and never expands to unlicensed collections. Read the full report before interpreting counts or claiming research-grade coverage.

## Focused spectrum workspace and T simulations

The landing page is unchanged. Searching a compound runs a data-loading progress bar, then opens the centered structure, name and FTIR / C-NMR / H-NMR / UV-VIS buttons without a header or footer. Ambiguous names require choosing a result. Uploaded unknowns remain unknown unless a candidate is explicitly opened; candidates are not confirmed identifications.

Technique buttons open draggable, resizable windows. FTIR switches between upward and downward views; measured absorbance converts using T% = 100 × 10^-A, while T values use an explicitly illustrative inversion. NMR defaults to sticks: measured traces use a local-extremum detector, position lists use non-quantitative markers, and T NMR uses illustrative environment centres, not calculated resonances. Both axes are labelled. Peak controls offer Off / Selected / All detected peaks. Auto-assignment proposes tentative structural environments (question marks), not confirmed assignments.

`theoretical-dataset-1500.json` stores all 1,500 memberships / 1,461 structures and 5,844 technique records. Rebuild with `npm run build:simulations`. FTIR/UV display grids remain 1 cm⁻¹ / 1 nm; legacy NMR envelope grids are 0.01 / 0.1 ppm, while the NMR viewer now uses exact analytical line positions from the separate first-order teaching model described above. Fine sampling does not improve chemical accuracy. UV bins and envelope weights are display assumptions, not transitions, oscillator strengths or calibrated intensities. Unsupported sites remain flagged. Original structural guides and measured records are unchanged; matching uses reviewed references only.

PNG, JPEG and CSV exports preserve the current view and its T/unreviewed provenance. Files are saved with unique names in `exports/` on this computer as well as offered for download. CSV includes method and tentative assignment metadata; raster exports retain a T provenance notice. Exports are derived outputs and are not included in full research-bank backups (originals and simulation records in SQLite are included). The local export API rejects unsupported formats and invalid signatures.

## Structure-derived dataset for all 1,500 collection entries

**Structure logic** contains independently authored, auditable SMARTS/graph rules, stored separately from measured spectra. The 1,500 collection memberships reference **1,461 unique compounds**; shared identities are not duplicated. Every successfully parsed source structure has functional-group matches with atom indices, carbon/hydrogen structural counts, conservative broad IR screening regions, broad ¹H/¹³C atom-environment guides, and qualitative UV chromophore flags. The export links actual imported experimental/literature evidence by exact identity and preserves its review/quarantine status and source license.

These are **educational heuristics**, not calculated quantum-chemical spectra, a trained spectral model, measured data, or calibrated identification probabilities. No exact peaks, intensities, coupling constants, splitting, fingerprint curves, resonance counts or UV λmax are generated. Atom counts are not signal counts. Rule-detected motifs may overlap, and symmetry, conformers, stereochemistry, solvent, hydrogen bonding, ionization, tautomers and instrumental conditions are not resolved. Charged/isotope-labelled structures are flagged. Failed structures stay explicitly unresolved. A missing experimental spectrum remains missing; every rule profile has `eligibleForMatching: false`.

Generated artifact: `logic-dataset-1500.json` (unique `entries` plus all 1,500 `memberships`). Download a current version using **Structure logic → Download full dataset**, or `/api/logic-dataset`. Profile rule definitions and explanatory primary teaching links are at `/api/logic-info`; detailed derived profiles appear in each compound’s dialog. Method version: `structural-guide-v1`. Source teaching pages explain the scientific principles; their text, images and spectra are not copied into the dataset. Existing identity and experimental-data licenses still apply to exports.

Rebuild locally with `npm run build:logic`. This uses local source SMILES and RDKit.js, with no AI API calls and no changes to researcher samples, experimental files or approval decisions. Profiles are persisted in SQLite schema v3 and included in database backups. Unit tests check acid/ester/amide distinctions, neutral vs charged structures, explicit missing predictions, atom counts vs resonances, and rejection of invalid SMILES.

## Contribute a measured library

1. Search a known, independently identified compound and select **Add measured spectra**. Record your sample ID, contributor, experimental origin or DOI, purity/preparation notes and reuse permission.
2. Attach FTIR, proton NMR, carbon NMR and/or UV–Vis from the **same physical sample**. Fill instrument and acquisition date. Add phase/mode/resolution for IR, solvent/frequency for NMR, solvent/concentration/path length for UV.
3. Save. The sample enters **pending review**, outside the matching library. Download original files and check metadata and identity evidence under **Samples & review**.
4. A reviewer records their name, independent identification evidence, quality checks and explicit confirmation. Approval is an auditable local assertion, not automatic external validation. This pilot has no reviewer authentication or two-person enforcement.
5. Upload a separate **unknown sample**. No compound is selected. Its measurements stay outside the reference library permanently unless a new, independently identified reference submission is created.

Original files are immutable, addressed by UUID and fingerprinted with SHA-256. Correct mistakes through a clearly labeled new submission; this version has no deletion/withdrawal/editor workflow. Do not approve erroneous submissions. If an approved submission later needs withdrawal, stop using its matches and request a withdrawal feature before further analysis.

## Supported numerical input

Plain numerical CSV, tab-separated or whitespace TXT: first column **x**, then one or more intensity traces, decimal point notation, no thousands separators. Multi-column files require an explicit intensity-column choice. One optional header; blank/comment rows accepted, at most 5 other unrecognized rows. At least 3 unique x points. Units: FTIR/Raman cm⁻¹, NMR ppm, UV/fluorescence nm, XRD 2θ degrees. Native binary files and JCAMP-DX remain archived-only through the reference submission workflow. The focused student workflow asks for exported numerical CSV/TXT rather than treating images, PDFs or native files as a numerical trace.

- FTIR and UV require continuous traces. FTIR supports absorbance or transmittance **percent** in (0,100]. Transmittance is converted to absorbance for comparison; the visible plot preserves uploaded values.
- NMR supports continuous traces or `(ppm, intensity)` peak lists. Peak-list comparison uses broadened sticks, not full multiplet assignment. Use consistent shift referencing and processing; solvent names must match after case/whitespace normalization.
- Maximum 25 MB per file, one per technique per sample; maximum total JSON request 75 MB (base64 increases file sizes), maximum 200,000 parsed points per file.

## Comparison limitations

Only approved, parseable **experimental reference samples** participate. Matching requires equal technique, units and format, consistent phase/IR measurement mode or solvent, and at least 70% shared x-range relative to the wider range. Missing/different conditions are excluded. Scores use interpolation, minimum-offset subtraction and cosine similarity over the shared range. NMR peak lists use Gaussian broadening (0.025 ppm for ¹H, 0.3 ppm for ¹³C). Ranking prioritizes number of matched modalities, then an equal-weight mean score. Missing modalities are not scored or invented.

These similarity scores are **not calibrated probabilities** and the algorithm has not been blind-validated against real research samples. No automated baseline correction, quality certification, shift alignment, library-wide peak assignment, mixture deconvolution or stereochemical identification is performed. Sparse traces, baselines, impurities and near-isomers can mislead it. A no-match may reflect missing coverage/conditions, not absence of a compound. Retrieved NMR or UV belongs to the candidate reference, not the unknown. Use orthogonal evidence and expert review; do not use this pilot for clinical, regulatory or definitive identification decisions.

No paid AI API is required for these local comparisons. Connecting additional measured reference datasets requires a separately checked spectral-data import, licensing and acquisition-metadata workflow; identity APIs alone do not provide FTIR/NMR/UV coverage.

## Storage, backups and recovery

- `data/spectratrace.sqlite`: compound metadata, collection membership/provenance, samples, parsed data, approval evidence, external sources/evidence, structural guides, separate T records, additional measured techniques, student hypotheses and cited microscopy caches, versioned schema (v6). SQLite uses foreign keys, WAL and prepared statements.
- `data/uploads/<UUID>`: original bytes. Files are outside public static assets and served only as downloads through the local server.
- **Storage → Create full backup** saves a consistent SQLite snapshot, original uploads, downloaded archives/extracted source files, catalog identity snapshot and restore instructions as `backups/*.tar.gz`. With this bulk import backups are substantially larger and slower. Backups are manual and not encrypted. Copy them to another protected drive; backups on the same drive alone do not protect against drive failure. Archive creation uses Windows' built-in `tar`.
- Restore: stop all SpectraTrace servers. Preserve the existing `data` folder by renaming/moving it to a safe location. Extract the backup into a separate folder. Copy the extracted `spectratrace.sqlite` and `uploads/` into a new `data/` folder, **without old WAL/SHM files**. Start again with the same application and catalog. Do not merge or overwrite an active database. Catalog startup is additive; use the catalog snapshot from the backup date when restoring an earlier catalog.
- To move computers, copy the application folder and data/backup together, install Node.js, then `npm install` and `npm start`.

This is a **single-user, local-only pilot**, not a worldwide collaboration service. No user accounts, access-control roles, encryption at rest, cloud synchronization or automated backups. Protect the computer/account and backup location. The server rejects foreign host/origin writes and binds to loopback; this is not a substitute for production authentication. Do not expose it through a tunnel or bind to all interfaces. Research files are not uploaded to AI or external sources during use.

## Checks

`npm test` uses isolated temporary databases under the workspace `work/` folder, not your actual research bank. Checks include exactly 500 records per collection, deduplication, original-file fidelity, unsupported parsing, unknown/pending exclusion, explicit review, compatible numerical comparison, backup generation, restart durability and SQLite integrity. Synthetic test fixtures are clearly labeled and never seeded into real data. Node's built-in SQLite currently emits an experimental-feature warning.
