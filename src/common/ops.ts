import toEmoji from "emoji-name-map";

const parseBoolean = (value: string | boolean | undefined): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    } else if (value.toLowerCase() === "false") {
      return false;
    }
  }
  return undefined;
};

const parseArray = (str: string | undefined): string[] => {
  if (!str) {
    return [];
  }
  return str.split(",");
};

const clampValue = (number: number, min: number, max: number): number => {
  if (Number.isNaN(parseInt(String(number), 10))) {
    return min;
  }
  return Math.max(min, Math.min(number, max));
};

const lowercaseTrim = (name: string): string => name.toLowerCase().trim();

const chunkArray = <T>(arr: T[], perChunk: number): T[][] => {
  return arr.reduce<T[][]>((resultArray, item, index) => {
    const chunkIndex = Math.floor(index / perChunk);
    if (!resultArray[chunkIndex]) {
      resultArray[chunkIndex] = [];
    }
    resultArray[chunkIndex]!.push(item);
    return resultArray;
  }, []);
};

const parseEmojis = (str: string): string => {
  if (!str) {
    throw new Error("[parseEmoji]: str argument not provided");
  }
  return str.replace(/:\w+:/gm, (emoji) => {
    return toEmoji.get(emoji) ?? "";
  });
};

const dateDiff = (d1: Date | string, d2: Date | string): number => {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  const diff = date1.getTime() - date2.getTime();
  return Math.round(diff / (1000 * 60));
};

export { parseBoolean, parseArray, clampValue, lowercaseTrim, chunkArray, parseEmojis, dateDiff };
