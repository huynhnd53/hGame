"""Builds a small parquet file shaped like the VIDA Google-Microsoft Open Buildings tiles for tests."""
# Run: python tests/fixtures/make_open_buildings_sample.py tests/fixtures/open-buildings-sample.parquet zstd (needs pyarrow)
import json, struct, sys
import pyarrow as pa, pyarrow.parquet as pq

def wkb_square(lon, lat, d):
    ring = [(lon, lat), (lon + d, lat), (lon + d, lat + d), (lon, lat + d), (lon, lat)]
    return struct.pack('<BII', 1, 3, 1) + struct.pack('<I', len(ring)) + b''.join(struct.pack('<dd', *p) for p in ring)

rows = []
# 4 bands of latitude, 200 buildings each going east, one row group per band.
for band in range(4):
    for k in range(200):
        lon = 105.80 + k * 0.001
        lat = 21.00 + band * 0.01
        src = 'google' if k % 5 else 'microsoft'
        conf = (0.5 + (k % 10) * 0.05) if src == 'google' else None
        rows.append((lon, lat, src, conf))
d = 0.0001
geom = [wkb_square(lon, lat, d) for lon, lat, _, _ in rows]
table = pa.table({
    'boundary_id': pa.array([1] * len(rows), pa.int64()),
    'bf_source': pa.array([r[2] for r in rows]),
    'confidence': pa.array([r[3] for r in rows], pa.float64()),
    'area_in_meters': pa.array([100.0] * len(rows)),
    's2_id': pa.array([3170534137668829184] * len(rows), pa.int64()),
    'country_iso': pa.array(['VNM'] * len(rows)),
    'geometry': pa.array(geom, pa.binary()),
    'bbox': pa.array([{'xmin': r[0], 'ymin': r[1], 'xmax': r[0] + d, 'ymax': r[1] + d} for r in rows],
                     pa.struct([('xmin', pa.float64()), ('ymin', pa.float64()), ('xmax', pa.float64()), ('ymax', pa.float64())])),
})
geo = {
    'version': '1.1.0', 'primary_column': 'geometry',
    'columns': {'geometry': {'encoding': 'WKB', 'geometry_types': ['Polygon'],
                             'covering': {'bbox': {'xmin': ['bbox', 'xmin'], 'ymin': ['bbox', 'ymin'], 'xmax': ['bbox', 'xmax'], 'ymax': ['bbox', 'ymax']}}}},
}
table = table.replace_schema_metadata({'geo': json.dumps(geo)})
# Small pages with a page index, so a reader can fetch just the pages of the rows it needs.
pq.write_table(table, sys.argv[1], row_group_size=200, compression=sys.argv[2] if len(sys.argv) > 2 else 'zstd',
               write_statistics=True, write_page_index=True, data_page_size=1024, write_batch_size=16, use_dictionary=['bf_source', 'country_iso'])
print(pq.ParquetFile(sys.argv[1]).metadata)
