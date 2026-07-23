import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromUrl } from "geotiff";

const TILE_ROOT = "https://copernicus-dem-30m.s3.amazonaws.com";
const LONGITUDE_TILE = "E086_00";
const X_START = 3132;
const X_END = 3528;
const OUTPUT_WIDTH = X_END - X_START;
const OUTPUT_ROWS = [
  { latitudeTile: "N28_00", yStart: 3474, yEnd: 3600 },
  { latitudeTile: "N27_00", yStart: 0, yEnd: 216 },
];

function tileUrl(latitudeTile) {
  const name = `Copernicus_DSM_COG_10_${latitudeTile}_${LONGITUDE_TILE}_DEM`;
  return `${TILE_ROOT}/${name}/${name}.tif`;
}

async function readRows({ latitudeTile, yStart, yEnd }) {
  const tiff = await fromUrl(tileUrl(latitudeTile));
  const image = await tiff.getImage();
  const [raster] = await image.readRasters({
    window: [X_START, yStart, X_END, yEnd],
  });
  return {
    latitudeTile,
    height: yEnd - yStart,
    values: raster,
  };
}

const rows = await Promise.all(OUTPUT_ROWS.map(readRows));
const outputHeight = rows.reduce((sum, row) => sum + row.height, 0);
const elevations = new Int16Array(OUTPUT_WIDTH * outputHeight);
let outputOffset = 0;

for (const row of rows) {
  for (let index = 0; index < row.values.length; index += 1) {
    elevations[outputOffset + index] = Math.round(row.values[index]);
  }
  outputOffset += row.values.length;
}

let minimumM = Number.POSITIVE_INFINITY;
let maximumM = Number.NEGATIVE_INFINITY;
let maximumIndex = 0;
for (let index = 0; index < elevations.length; index += 1) {
  const value = elevations[index];
  if (value < minimumM) minimumM = value;
  if (value > maximumM) {
    maximumM = value;
    maximumIndex = index;
  }
}

const bytes = Buffer.allocUnsafe(elevations.length * 2);
for (let index = 0; index < elevations.length; index += 1) {
  bytes.writeInt16LE(elevations[index], index * 2);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const outputDirectory = resolve(projectDirectory, "public", "data");
await mkdir(outputDirectory, { recursive: true });

const north = 28.035;
const south = 27.94;
const west = 86.87;
const east = 86.98;
const maximumRow = Math.floor(maximumIndex / OUTPUT_WIDTH);
const maximumColumn = maximumIndex % OUTPUT_WIDTH;
const metadata = {
  id: "COP-DEM-GLO-30-EVEREST-001",
  source: "Copernicus WorldDEM-30 (GLO-30)",
  sourceResolutionM: 30,
  format: "signed-int16-little-endian",
  width: OUTPUT_WIDTH,
  height: outputHeight,
  bounds: { north, south, west, east },
  minimumM,
  maximumM,
  maximumCoordinate: {
    latitude: north - (maximumRow + 0.5) / 3600,
    longitude: west + (maximumColumn + 0.5) / 3600,
  },
  sha256: createHash("sha256").update(bytes).digest("hex"),
  attribution:
    "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
  processing:
    "Two public GLO-30 COG tiles were clipped and joined without elevation resampling. The browser adds deterministic sub-grid visual detail; that detail is synthetic and is never represented as measured elevation.",
};

await writeFile(resolve(outputDirectory, "everest-dem.int16"), bytes);
await writeFile(
  resolve(outputDirectory, "everest-dem.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
);

console.log(
  `Wrote ${OUTPUT_WIDTH} × ${outputHeight} Everest DEM (${minimumM}–${maximumM} m).`,
);
