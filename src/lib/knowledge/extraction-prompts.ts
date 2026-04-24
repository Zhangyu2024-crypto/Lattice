// Chain extraction prompts ported from lattice-cli/tools/paper_extract.py.
// Used by llm-extract.ts to call the LLM via Electron IPC.

export const EXTRACT_CHAINS_SYSTEM = `You are a scientific data extraction specialist. Return only valid JSON.`

export const EXTRACT_CHAINS_PROMPT = `Extract causal/logical chains from the following scientific text.

Each chain represents a complete pathway: System → Process → State → Measurement

ROLE DEFINITIONS:
- **system**: The starting material, composition, reagent, or input.
  Examples: "Al₂O₃ (40 wt%)", "BaTiO₃", "90mol% CaAl₂Si₂O₈ - 10mol% CaMgSi₂O₆"
- **process**: Any treatment, synthesis step, or experimental condition applied.
  Examples: "sintering temperature 1100°C", "ball-milled 24h", "annealed in N₂"
- **state**: The resulting structure, phase, microstructure, or intermediate product.
  Examples: "anorthite + diopside phase", "grain size 2.3 μm", "BCC crystal structure"
- **measurement**: A measured/reported property or performance metric.
  Examples: "flexural strength 180 MPa", "bandgap 2.1 eV", "thermal conductivity 5.2 W/mK"

RULES:
1. Each chain must have at least 2 nodes.
2. Whenever the text mentions a numerical value, it MUST appear in the node's "value" field (with "unit" when applicable). Do NOT collapse "1100°C" into the name — split it into name="sintering temperature", value="1100", unit="°C".
3. "context_text" is REQUIRED and must copy a complete sentence from the source text verbatim (max 200 chars, minimum ~40 chars). Do NOT stitch together keywords or phrases — quote the actual sentence that supports the chain.
4. Include "confidence" in [0, 1] based on how explicitly the text states the relationship.
5. "system" must name a concrete material — full chemical formula (e.g. "Al₂O₃-SiO₂ ceramic") or, for review/theoretical papers where no single compound is studied, a class-level label ("perovskite oxides", "NiCoMn-layered hydroxides"). Never use empty placeholders like "sample", "material", "the compound".
6. Experimental parameters (temperature, pressure, time, rate, atmosphere) are PROCESS nodes — put the number in "value" + unit in "unit".
7. Crystal structures, phases, morphology are STATE nodes — put the descriptor in "value".
8. Mechanical/thermal/electrical/optical properties are MEASUREMENT nodes — put the number in "value" + unit in "unit".
9. If a measurement node names a characterization technique (SEM, TEM, XRD, Raman, XPS, FTIR, BET, ...), the chain MUST also carry the concrete observation the technique produced — grain size, phase assignment, peak position, morphology, binding energy, etc. — either in that node's "value" or in an accompanying STATE node. A chain whose only measurement is a bare technique name (no observation, no value) is low-signal — drop it instead of emitting.
10. Every chain MUST carry at least one quantitative signal — either a node with "value"+"unit" or a number+unit clearly legible inside context_text. Chains with no numbers anywhere are not worth extracting.
11. A single sentence may produce multiple chains if it describes multiple pathways.
12. Prefer COMPLETE chains (all 4 roles) when the text supports it.
13. Return every chain that satisfies rules 1-10 — even a 2-node "system → measurement" chain is useful. Do NOT silently skip valid chains, and do NOT emit chains that would violate rule 9 or 10.

OUTPUT FORMAT (JSON only, no markdown fences):
{"chains": [
  {
    "domain_type": "materials",
    "context_text": "The sample sintered at 1100°C showed flexural strength of 180 MPa",
    "confidence": 0.85,
    "nodes": [
      {"role": "system", "name": "Al₂O₃-SiO₂ ceramic", "value": null, "unit": null},
      {"role": "process", "name": "sintering temperature", "value": "1100", "unit": "°C"},
      {"role": "state", "name": "phase composition", "value": "anorthite + diopside", "unit": null},
      {"role": "measurement", "name": "flexural strength", "value": "180", "unit": "MPa"}
    ]
  }
]}

Text:
{text}

Extract all chains. Return valid JSON only.`

export const BATCH_EXTRACT_PROMPT = `Extract causal/logical chains from the following paper sections.

Each chain represents a complete pathway: System → Process → State → Measurement

ROLE DEFINITIONS:
- **system**: Material composition, reagent, or input — use FULL chemical formula (e.g. "Bi2Te3", "Al2O3-SiO2 40/60 wt%"), never generic labels like "sample A".
- **process**: Treatment, synthesis step, or experimental condition. MUST carry the numerical parameter in "value" + "unit" whenever the text mentions one (e.g. temperature, pressure, time, rate, atmosphere).
- **state**: Resulting structure, phase, microstructure, morphology. Put the descriptor in "value" (e.g. value="R-3m", value="anorthite + diopside", value="2.3 μm grains").
- **measurement**: Measured property or performance metric. MUST carry the numerical value + unit (e.g. ZT=0.8, conductivity=850 S/cm).

RULES:
1. Each chain has at least 2 nodes.
2. Whenever the text mentions a numerical value, put it in the node's "value" field and put the unit in "unit" when applicable.
3. "context_text" is REQUIRED and must be a complete sentence copied verbatim from the paper (max 200 chars, minimum ~40 chars). Do NOT stitch keywords.
4. context_section should name the section the chain came from ("Results", "Experimental", etc.) when known.
5. confidence should be a number in [0, 1].
6. Material names must be full compositions or explicit class labels ("perovskite oxides"), never placeholders like "sample" / "material" / "the compound".
7. Experimental parameters are PROCESS nodes, NOT measurements.
8. If a measurement node names a bare characterization technique (SEM, TEM, XRD, Raman, XPS, FTIR, BET, ...), the chain MUST also carry the concrete observation (grain size, phase, peak position, morphology, ...) — in value/unit on a node or as a state descriptor. Bare-technique chains are low-signal — drop them.
9. Every chain MUST carry at least one quantitative signal (value+unit on a node, or a number+unit legible in context_text).
10. Return every chain that satisfies rules 1-9. Do NOT silently skip valid chains, and do NOT emit chains that violate rules 8 or 9.

OUTPUT FORMAT (JSON only, no markdown fences):
{"chains": [
  {
    "domain_type": "materials",
    "context_text": "The sample sintered at 1100°C showed flexural strength of 180 MPa",
    "context_section": "Results",
    "confidence": 0.88,
    "nodes": [
      {"role": "system", "name": "Al2O3-SiO2 ceramic", "value": null, "unit": null},
      {"role": "process", "name": "sintering temperature", "value": "1100", "unit": "°C"},
      {"role": "state", "name": "phase composition", "value": "anorthite + diopside", "unit": null},
      {"role": "measurement", "name": "flexural strength", "value": "180", "unit": "MPa"}
    ]
  }
]}

Paper sections:
{text}

Extract every chain you can identify. Return valid JSON only.`

export const DATA_NODE_SELECTION_PROMPT = `You are analyzing a scientific paper's structure to find sections containing extractable experimental data.

Paper tree (titles + summaries):
{tree_json}

Identify ALL nodes that likely contain:
- Experimental parameters (temperature, pressure, composition, time, etc.)
- Numerical results (measurements, metrics, performance values)
- Spectral/diffraction data (peak positions, intensities)
- Material properties (crystal structure, band gap, lattice parameters)

Reply in JSON:
{"data_nodes": ["node_id_1", "node_id_2", ...], "reasoning": "brief explanation"}
Return ONLY the JSON. If no data-rich nodes exist, return {"data_nodes": []}.`

export const CLASSIFY_PROJECT_PROMPT = `You are a scientific paper classifier. Given the paper title and content snippet below, assign this paper to the MOST appropriate research project category.

RULES:
1. Category names should be concise research topics (2-5 words), e.g. "Glass-Ceramics Luminescence", "Bioactive Glass Scaffolds", "Dielectric Ceramics"
2. Return the SINGLE best-matching category
3. Include 3-5 keywords that describe this paper's focus

Paper title: {title}
Content snippet: {content}

Return JSON only:
{"project_name": "...", "confidence": 0.85, "keywords": ["...", "..."]}`
