import { DOMWindow } from "jsdom";
import { Chapter, ChapterContent, Footnote, FootnoteReference, ParseTree, Verse, Text, VerseContent, HebrewSubtitle } from "./types";
import { trim } from "lodash";

enum NodeType {
    Text = 3,
}

const PROCESSED_VERSES_SYMBOL = Symbol('processed_verses');

/**
 * Defines a class that is able to parse USX content.
 */
export class USXParser {

    private window: DOMWindow;

    private _noteCounter: number = 0;

    constructor(window: DOMWindow) {
        this.window = window;
    }

    /**
     * Parses the specified USX content.
     *
     * @param usx The USX content to parse.
     * @returns The parse tree that was generated.
     */
    public parse(usx: string): ParseTree {
        const parser = new this.window.DOMParser();
        const doc = parser.parseFromString(usx, 'application/xml');
        const usxElement = doc.documentElement;

        let root: ParseTree = {
            type: 'root',
            content: []
        };

        const bookElement = usxElement.querySelector('book[code]');

        if (!bookElement) {
            throw new Error('The USX content does not contain a book element.');
        }

        const bookCode = bookElement.getAttribute('code') || '';

        if (!bookCode) {
            throw new Error('The book element does not contain a code attribute.');
        }

        root.id = bookCode;

        const header = usxElement.querySelector('para[style="h"]');
        if (header) {
            root.header = header.textContent || '';
        }

        const titles = usxElement.querySelectorAll('para[style="mt1"], para[style="mt2"], para[style="mt3"]');
        // const title2 = usxElement.querySelector('para[style="mt2"]');
        // const title3 = usxElement.querySelector('para[style="mt3"]');

        if (titles.length > 0) {
            root.title = [...titles].map(t => t.textContent).filter(t => t).join(' ');
        }

        for(let content of this.iterateRootContent(usxElement)) {
            root.content.push(content);
        }

        return root;
    }

    
    *iterateRootContent(usxElement: Element): Generator<ParseTree['content'][0]> {
        const iterator = iterateChildren(usxElement);
        for(let child of iterator) {
            if (child.nodeName === 'chapter') {
                if (child.hasAttribute('eid')) {
                    continue;
                }

                const chapter: Chapter = {
                    type: 'chapter',
                    number: parseInt(child.getAttribute('number') || '0', 10),
                    content: [],
                    footnotes: [],
                };

                for(let content of this.iterateChapterContent(uncompletable(iterator), chapter)) {
                    chapter.content.push(content);
                }

                yield chapter;
            } else if (child.nodeName === 'para') {
                const style = child.getAttribute('style');
                if (style === 's1' || style === 's2' || style === 's3' || style === 's4') {
                    yield {
                        type: 'heading',
                        content: child.textContent ? [ child.textContent ] : []
                    };
                }
            }
        }
    }

    *iterateChapterContent(chapterSiblings: IterableIterator<Element>, chapter: Chapter): Generator<ChapterContent> {
        for(let sibling of chapterSiblings) {
            if (sibling.nodeName === 'para') {
                for(let content of this.iterateChapterParaContent(sibling, chapter)) {
                    yield content;
                }
            } else if (sibling.nodeName === 'chapter') {
                break;
            }
        }
    }


    *iterateChapterParaContent(para: Element, chapter: Chapter): IterableIterator<ChapterContent> {
        const style = para.getAttribute('style');
        if (style === 's1' || style === 's2' || style === 's3' || style === 's4') {
            yield {
                type: 'heading',
                content: para.textContent ? [ para.textContent ] : []
            };
        } else if (style === 'b') {
            yield {
                type: 'line_break',
            };
        } else if (style === 'd') {
            yield this.parseHebrewSubtitle(para, chapter);
        } else if (!style || !ignoredParaStyles.has(style)) {
            yield *this.iterateChapterParaVerseContent(para, chapter);
        }
    }

    *iterateChapterParaVerseContent(para: Element, chapter: Chapter): IterableIterator<ChapterContent> {
        const elements = iterateChildren(para);
        for(let element of elements) {
            if (element.nodeName === 'chapter') {
                break;
            }
            if (element.nodeName === 'verse') {
                if (element.hasAttribute('eid')) {
                    continue;
                }

                const verse: Verse = {
                    type: 'verse',
                    number: parseInt(element.getAttribute('number') || '0', 10),
                    content: []
                };

                for(let content of this.iterateVerseContent(element, chapter, verse)) {
                    addOrJoin(verse.content, content);
                }

                trimContent(verse.content);
                yield verse;
            }
        }
    }

    *iterateVerseContent(element: Element, chapter: Chapter, verse: Verse): IterableIterator<string | FootnoteReference | Text> {
        for(let { node, parent } of this.iterateUntilEndingVerse(element)) {
            if (node.nodeName === 'verse') {
                break;
            }

            let poem: number | null = null;

            if (parent.nodeName === 'para') {
                const style = parent.getAttribute('style');
                if (style === 'q1' || style === 'q2' || style === 'q3' || style === 'q4') {
                    poem = style === 'q1' ? 1 : style === 'q2' ? 2 : style === 'q3' ? 3 : 4;
                }
            }

            for(let content of this.iterateNodeTextContent(node, chapter, verse)) {
                if (poem !== null) {
                    if (typeof content === 'string') {
                        yield {
                            text: content,
                            poem,
                        };
                    } else {
                        yield {
                            ...content,
                            poem,
                        };
                    }
                } else {
                    yield content;
                }
            }
        }
    }

    *iterateUntilEndingVerse(element: Element): IterableIterator<{ node: Node, parent: Element }> {
        for(let node of iterateSiblingsAndCousins(element)) {
            if (node.node.nodeName === 'verse') {
                break;
            }
            yield node;
        }
    }

    parseHebrewSubtitle(para: Element, chapter: Chapter): HebrewSubtitle {
        const subtitle: HebrewSubtitle = {
            type: 'hebrew_subtitle',
            content: []
        };

        for(let content of this.iterateHebrewSubtitleContent(para, chapter)) {
            addOrJoin(subtitle.content, content);
        }

        trimContent(subtitle.content);
        return subtitle;
    }

    *iterateHebrewSubtitleContent(element: Element, chapter: Chapter): IterableIterator<string | Text | FootnoteReference> {
        for (let node of iterateNodes(element)) {
            yield *this.iterateNodeTextContent(node, chapter);
        }
    }

    *iterateNodeTextContent(node: Node, chapter: Chapter, verse?: Verse): IterableIterator<string | Text | FootnoteReference> {
        if (node.nodeType === NodeType.Text) {
            yield node.textContent || '';
        } else if (node instanceof Element && node.nodeName === 'char') {
            yield *iterateCharContent(node);
        } else if (node instanceof Element && node.nodeName === 'note') {
            const style = node.getAttribute('style');
            if (style === 'f') {
                const verseReferenceRegex = /^[0-9]{1,3}:[0-9]{1,3}/;

                let text = trimText(node.textContent || '').trim();
                
                if (verseReferenceRegex.test(text)) {
                    text = text.replace(verseReferenceRegex, '').trim();
                }

                const note: Footnote = {
                    noteId: this._noteCounter++,
                    caller: node.getAttribute('caller') || null,
                    text,
                    reference: {
                        chapter: chapter.number,
                        verse: verse?.number ?? 0
                    }
                };

                chapter.footnotes.push(note);

                yield {
                    noteId: note.noteId
                };
            }
        }
    }


}

function *iterateChildren(node: Element) {
    for(let i = 0; i < node.children.length; i++) {
        yield node.children[i];
    }
}

function *iterateSiblingElements(node: Element) {
    let next = node.nextElementSibling;
    while(next) {
        yield next;
        next = next.nextElementSibling;
    }
}

function *iterateSiblingNodes(node: Node | null | undefined) {
    let next = node?.nextSibling;
    while(next) {
        yield next;
        next = next.nextSibling;
    }
}

function *iterateNodes(node: Node) {
    for(let i = 0; i < node.childNodes.length; i++) {
        yield node.childNodes[i];
    }
}

/**
* Constructs an interator that iterates over an element's siblings and then its cousins.
* @param para The para element.
*/
function *iterateSiblingsAndCousins(node: Node | null | undefined): IterableIterator<{ node: Node, parent: Element }> {
    if (!node) {
        return;
    }
    for(let sibling of iterateSiblingNodes(node)) {
        yield {
            node: sibling,
            parent: sibling.parentElement!
        };
    }


    let uncle = node?.parentElement?.nextElementSibling;

    if (uncle) {
        let siblingNode = node?.parentElement?.nextSibling;
        while (siblingNode && siblingNode !== uncle) {
            yield {
                node: siblingNode,
                parent: siblingNode.parentElement!
            };
            siblingNode = siblingNode.nextSibling;
        }
    }

    const child = uncle?.firstChild;
    if (child) {
        yield {
            node: child,
            parent: uncle!
        };

        yield *iterateSiblingsAndCousins(child);
    }
}


// function *iterateChapterContent(element: Element): Generator<ChapterContent> {
//     for(let sibling of iterateSiblingElements(element)) {
//         if (sibling.nodeName === 'para') {
//             for(let content of iterateChapterParaContent(sibling)) {
//                 yield content;
//             }
//         }
//         if (sibling.nodeName === 'chapter') {
//             break;
//         }
//     }
// }

// Taken from https://github.com/gracious-tech/fetch/blob/1576cc4eafb32bf347a09332094cf17c2231c90c/converters/usx-to-json/src/elements.ts#L16
const ignoredParaStyles = new Set([
    // <para> Identification [exclude all] - Running headings & table of contents
    'ide',  // See https://github.com/schierlm/BibleMultiConverter/issues/67
    'rem',  // Remarks (valid in schema though missed in docs)
    'h', 'h1', 'h2', 'h3', 'h4',
    'toc1', 'toc2', 'toc3',
    'toca1', 'toca2', 'toca3',

    /* <para> Introductions [exclude all] - Introductionary (non-biblical) content
        Which might be helpful in a printed book, but intro material in apps is usually bad UX,
        and users that really care can research a translations methodology themselves
    */
    'imt', 'imt1', 'imt2', 'imt3', 'imt4',
    'is', 'is1', 'is2', 'is3', 'is4',
    'ip',
    'ipi',
    'im',
    'imi',
    'ipq',
    'imq',
    'ipr',
    'iq', 'iq1', 'iq2', 'iq3', 'iq4',
    'ib',
    'ili', 'ili1', 'ili2', 'ili3', 'ili4',
    'iot',
    'io', 'io1', 'io2', 'io3', 'io4',
    'iex',
    'imte',
    'ie',

    /* <para> Headings [exclude some] - Exclude book & chapter headings but keep section headings
        Not excluded: ms# | mr | s# | sr | d | sp | sd#
    */
    'mt', 'mt1', 'mt2', 'mt3', 'mt4',
    'mte', 'mte1', 'mte2', 'mte3', 'mte4',
    'cl',
    'cd',  // Non-biblical chapter summary, more than heading
    'r',  // Parallels to be provided by external data
]);


function *iterateCharContent(char: Element): IterableIterator<string | Text> {
    const style = char.getAttribute('style');
    const text = trimText(char.textContent || '');
    if (style === 'wj') {
        yield {
            text,
            wordsOfJesus: true
        };
    } else {
        yield text;
    }
}

function trimText(text: string): string {
    return text.replace(/\s+/g, ' ');
}

function trimContent<T extends string | unknown>(content: T[]): T[] {
    for (let i = 0; i< content.length; i++) {
        const value = content[i];
        if (typeof value === 'string') {
            content[i] = trimText(value as string).trim() as T;
            if (content[i] === '') {
                content.splice(i, 1);
                i--;
                continue;
            }
        } else if (isVerseText(value)) {
            value.text = trimText(value.text).trim();
            if (value.text === '') {
                content.splice(i, 1);
                i--;
                continue;
            }
        }
    }
    return content;
}

function addOrJoin(array: (string | unknown)[], value: string | unknown) {
    if (array.length === 0) {
        array.push(value);
    } else {
        const last = array[array.length - 1];
        if (typeof last === 'string' && typeof value === 'string') {
            array[array.length - 1] = last + value;
        } else if (isVerseText(last) && isVerseText(value) && hasSameFormatting(last, value)) {
            last.text += value.text;
        } else {
            array.push(value);
        }
    }
}

function isVerseText(value: unknown): value is Text {
    return typeof value === 'object' && value !== null && 'text' in value;
}

function hasSameFormatting(a: Text, b: Text): boolean {
    return a.poem === b.poem && a.wordsOfJesus === b.wordsOfJesus;
}

/**
 * Wraps the given iterable in a generator that will prevent consumers from calling return() on the iterator.
 * @param iterable The iterable.
 */
function *uncompletable<T>(iterable: IterableIterator<T>): IterableIterator<T> {
    while(true) {
        const { done, value } = iterable.next();
        if (done) {
            return;
        }
        yield value;
    }
}

function hasProcessedVerses(node: Node): boolean {
    const processed = !!(node as any)[PROCESSED_VERSES_SYMBOL];
    if(!processed) {
        (node as any)[PROCESSED_VERSES_SYMBOL] = true;
    }
    return processed;
}