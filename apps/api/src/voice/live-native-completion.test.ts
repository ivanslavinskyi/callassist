import {expect,it} from "vitest";
import {hasNativeFarewellCue} from "./live-native-completion";

it.each(["Danke und auf Wiederhören.","Vielen Dank, auf Wiedersehen!","Thank you, goodbye.","Bye.","Merci et au revoir.","Bonne journée.","Grazie, arrivederci.","A revair.","До свидания.","Дякую, до побачення!"])("recognizes a scheduling cue in %s",text=>{
  expect(hasNativeFarewellCue(text)).toBe(true);
});
it.each(["Which pizza would you like?","Thank you.","Goodbye is the title of the book. What time?","Auf Wiederhören. Noch eine Frage:","goodbyes","I am looking for Bye Street."])("does not accelerate ordinary or resumed speech: %s",text=>{
  expect(hasNativeFarewellCue(text)).toBe(false);
});
