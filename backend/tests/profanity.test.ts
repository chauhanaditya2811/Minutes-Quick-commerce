import { describe, expect, it } from "vitest";
import { containsBlockedWords } from "../src/utils/profanity.js";

describe("containsBlockedWords", () => {
  it.each([
    // plain, across languages
    "fuck", "Bitch please", "chutiya", "bc", "MC", "bsdk", "Bhenchod", "randi", "kutta", "kanjar",
    "zavadya", "bokachoda", "bhosrina", "thevidiya", "lanja", "soole magane", "myre",
    // endings and casing
    "FUCKING", "Fucker juice", "bitchy",
    // spelling tricks
    "f u c k", "f.u.c.k", "f-u-c-k", "fuuuuck", "chuuutiya", "sh1t", "a55", "b1tch", "ch00tiya",
    // hidden inside other letters or split across words
    "xxmadarchodxx", "teri maa ki", "Teri Maaki", "mother fucker", "behen chod",
  ])("blocks %j", (text) => {
    expect(containsBlockedWords(text)).toBe(true);
  });

  it.each([
    "Maggi", "Maggi Masala 70 g", "Red Bull 250 ml", "Coca-Cola 750 ml", "Assam Tea", "Glass cleaner",
    "Cocktail mix", "Shiitake mushroom", "Unisex deodorant", "Durex condoms", "Scotch Brite",
    "Lays Magic Masala", "Amul Kool Coffee", "Dark Fantasy", "Head & Shoulders", "Kurkure", "Bourbon",
    "Pass Pass mouth freshener", "Gud (jaggery) 500 g", "Poori mix", "Haldiram Bhujia", "Amul 455 ml",
    "Classmate notebook", "Hershey's Kisses", "Dabur Honey", "Basmati rice", "Sunfeast Dark Fantasy",
    "Grass jelly", "Massage oil", "Pocket tissues", "Cadbury Dairy Milk", "Kitkat", "Butterscotch",
  ])("allows %j", (text) => {
    expect(containsBlockedWords(text)).toBe(false);
  });
});
