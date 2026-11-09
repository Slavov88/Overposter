# Poster design

Academic Classic uses a restrained editorial grid for dense research content. Modern ML emphasizes a strong title band, method, quantitative results, and compact supporting detail. Visual Results gives more space to figures and captions. All layouts use shared spacing and type macros in `templates/shared/` and support two to four columns and font scaling from 0.8 to 1.25.

Use short sections with one main claim each. Keep vector plots and diagrams as PDF in `figures/`; convert SVG before compilation. Include figure captions that state the measure, sample, and whether values are illustrative. Check title wrapping, equations, legends, logos, and QR at the actual print dimensions. Preflight verifies physical properties but cannot establish visual quality or scientific validity.

The committed sample is illustrative. Its numeric values must not be represented as experimental evidence. Gallery previews are generated from compiled example posters and should be regenerated after template changes.

At the default scale, body text is 27 pt with 35 pt leading, section headings are 40 pt, and titles are 68 pt. The scale setting multiplies these values. For each edited layout, build all examples, inspect preflight warnings, render the actual PDFs at poster scale, and refresh the checked-in template previews from the gallery PDFs.
