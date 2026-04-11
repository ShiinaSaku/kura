import wrap from "word-wrap";
import { encodeHTML } from "./html";

const kFormatter = (num: number, precision?: number): string | number => {
  const abs = Math.abs(num);
  const sign = Math.sign(num);

  if (typeof precision === "number" && !isNaN(precision)) {
    return (sign * (abs / 1000)).toFixed(precision) + "k";
  }

  if (abs < 1000) {
    return sign * abs;
  }

  return sign * parseFloat((abs / 1000).toFixed(1)) + "k";
};

const formatBytes = (bytes: number): string => {
  if (bytes < 0) {
    throw new Error("Bytes must be a non-negative number");
  }

  if (bytes === 0) {
    return "0 B";
  }

  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
  const base = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(base));

  if (i >= sizes.length) {
    throw new Error("Bytes is too large to convert to a human-readable string");
  }

  return `${(bytes / Math.pow(base, i)).toFixed(1)} ${sizes[i]}`;
};

const wrapTextMultiline = (text: string, width = 59, maxLines = 3): string[] => {
  const fullWidthComma = "，";
  const encoded = encodeHTML(text);
  const isChinese = encoded.includes(fullWidthComma);

  let wrapped: string[];

  if (isChinese) {
    wrapped = encoded.split(fullWidthComma);
  } else {
    wrapped = wrap(encoded, { width }).split("\n");
  }

  const lines = wrapped.map((line) => line.trim()).slice(0, maxLines);

  if (wrapped.length > maxLines) {
    lines[maxLines - 1] += "...";
  }

  const multiLineText = lines.filter(Boolean);
  return multiLineText;
};

export { kFormatter, formatBytes, wrapTextMultiline };
