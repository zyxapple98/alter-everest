import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromUrl } from "geotiff";

const TILE_ROOT = "https://copernicus-dem-30m.s3.amazonaws.com";
const ARC_SECONDS_PER_DEGREE = 3600;
const imageCache = new Map();

const layers = [
  {
    stem: "everest-dem",
    id: "COP-DEM-GLO-30-EVEREST-CORE-001",
    lod: "core",
    displayResolutionM: 30,
    sampleSpacingArcSeconds: 1,
    bounds: { north: 28.035, south: 27.94, west: 86.87, east: 86.98 },
  },
  {
    stem: "everest-dem-mid",
    id: "COP-DEM-GLO-30-EVEREST-MID-001",
    lod: "mid",
    displayResolutionM: 90,
    sampleSpacingArcSeconds: 3,
    bounds: { north: 28.2, south: 27.775, west: 86.7, east: 87.15 },
  },
  {
    stem: "everest-dem-far",
    id: "COP-DEM-GLO-30-EVEREST-FAR-001",
    lod: "far",
    displayResolutionM: 300,
    sampleSpacingArcSeconds: 10,
    bounds: { north: 28.45, south: 27.5, west: 86.4, east: 87.45 },
  },
];

function coordinateLabel(value, positivePrefix, negativePrefix) {
  const prefix = value >= 0 ? positivePrefix : negativePrefix;
  return `${prefix}${String(Math.abs(value)).padStart(3, "0")}_00`;
}

function tileUrl(latitude, longitude) {
  const latitudeLabel =
    `${latitude >= 0 ? "N" : "S"}${String(Math.abs(latitude)).padStart(2, "0")}_00`;
  const longitudeLabel = coordinateLabel(longitude, "E", "W");
  const name =
    `Copernicus_DSM_COG_10_${latitudeLabel}_${longitudeLabel}_DEM`;
  return `${TILE_ROOT}/${name}/${name}.tif`;
}

async function getImage(latitude, longitude) {
  const key = `${latitude}:${longitude}`;
  if (!imageCache.has(key)) {
    imageCache.set(
      key,
      fromUrl(tileUrl(latitude, longitude)).then((tiff) => tiff.getImage()),
    );
  }
  return imageCache.get(key);
}

function integerSize(spanDegrees, sampleSpacingArcSeconds) {
  const value =
    (spanDegrees * ARC_SECONDS_PER_DEGREE) / sampleSpacingArcSeconds;
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > 1e-6) {
    throw new Error(`Layer extent does not align to ${sampleSpacingArcSeconds}".`);
  }
  return rounded;
}

async function buildLayer(layer) {
  const { bounds, sampleSpacingArcSeconds } = layer;
  const width = integerSize(
    bounds.east - bounds.west,
    sampleSpacingArcSeconds,
  );
  const height = integerSize(
    bounds.north - bounds.south,
    sampleSpacingArcSeconds,
  );
  const elevations = new Int16Array(width * height);
  const latitudeTiles = [];
  const longitudeTiles = [];

  for (
    let latitude = Math.floor(bounds.north - 1e-10);
    latitude >= Math.floor(bounds.south);
    latitude -= 1
  ) {
    latitudeTiles.push(latitude);
  }
  for (
    let longitude = Math.floor(bounds.west);
    longitude <= Math.floor(bounds.east - 1e-10);
    longitude += 1
  ) {
    longitudeTiles.push(longitude);
  }

  for (const latitude of latitudeTiles) {
    for (const longitude of longitudeTiles) {
      const segment = {
        north: Math.min(bounds.north, latitude + 1),
        south: Math.max(bounds.south, latitude),
        west: Math.max(bounds.west, longitude),
        east: Math.min(bounds.east, longitude + 1),
      };
      const segmentWidth = integerSize(
        segment.east - segment.west,
        sampleSpacingArcSeconds,
      );
      const segmentHeight = integerSize(
        segment.north - segment.south,
        sampleSpacingArcSeconds,
      );
      const outputColumn = integerSize(
        segment.west - bounds.west,
        sampleSpacingArcSeconds,
      );
      const outputRow = integerSize(
        bounds.north - segment.north,
        sampleSpacingArcSeconds,
      );
      const sourceWindow = [
        Math.round((segment.west - longitude) * ARC_SECONDS_PER_DEGREE),
        Math.round(
          (latitude + 1 - segment.north) * ARC_SECONDS_PER_DEGREE,
        ),
        Math.round((segment.east - longitude) * ARC_SECONDS_PER_DEGREE),
        Math.round(
          (latitude + 1 - segment.south) * ARC_SECONDS_PER_DEGREE,
        ),
      ];
      const image = await getImage(latitude, longitude);
      const [values] = await image.readRasters({
        window: sourceWindow,
        width: segmentWidth,
        height: segmentHeight,
        resampleMethod:
          sampleSpacingArcSeconds === 1 ? "nearest" : "bilinear",
      });

      for (let row = 0; row < segmentHeight; row += 1) {
        const sourceOffset = row * segmentWidth;
        const destinationOffset =
          (outputRow + row) * width + outputColumn;
        for (let column = 0; column < segmentWidth; column += 1) {
          elevations[destinationOffset + column] = Math.round(
            values[sourceOffset + column],
          );
        }
      }
    }
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

  const maximumRow = Math.floor(maximumIndex / width);
  const maximumColumn = maximumIndex % width;
  const degreesPerSample =
    sampleSpacingArcSeconds / ARC_SECONDS_PER_DEGREE;
  const metadata = {
    id: layer.id,
    lod: layer.lod,
    source: "Copernicus WorldDEM-30 (GLO-30)",
    sourceResolutionM: 30,
    displayResolutionM: layer.displayResolutionM,
    sampleSpacingArcSeconds,
    format: "signed-int16-little-endian",
    width,
    height,
    bounds,
    minimumM,
    maximumM,
    maximumCoordinate: {
      latitude: bounds.north - (maximumRow + 0.5) * degreesPerSample,
      longitude: bounds.west + (maximumColumn + 0.5) * degreesPerSample,
    },
    sha256: createHash("sha256").update(bytes).digest("hex"),
    attribution:
      "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
    processing:
      sampleSpacingArcSeconds === 1
        ? "Public GLO-30 COG tiles were clipped and joined without elevation resampling. The browser adds deterministic sub-grid visual detail; that detail is synthetic and is never represented as measured elevation."
        : `Public GLO-30 COG tiles were mosaicked and bilinearly resampled to a ${layer.displayResolutionM} m display LOD. This remains a visualization derivative of the 30 m source, not new measured elevation.`,
  };

  return { layer, metadata, bytes };
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const outputDirectory = resolve(projectDirectory, "public", "data");
await mkdir(outputDirectory, { recursive: true });

for (const layer of layers) {
  const result = await buildLayer(layer);
  await writeFile(
    resolve(outputDirectory, `${layer.stem}.int16`),
    result.bytes,
  );
  await writeFile(
    resolve(outputDirectory, `${layer.stem}.json`),
    `${JSON.stringify(result.metadata, null, 2)}\n`,
  );
  console.log(
    `Wrote ${result.metadata.lod} ${result.metadata.width} × ${result.metadata.height} DEM (${result.metadata.minimumM}–${result.metadata.maximumM} m).`,
  );
}
