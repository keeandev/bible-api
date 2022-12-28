import * as React from 'react';
import type { TranslationBookChapter, ChapterData, ChapterContent, ChapterVerse } from '../usfm-parser/generator';
import type { PageProps } from 'gatsby';
import Layout from '../components/Layout';

type ArrayElement<ArrayType extends readonly unknown[]> = 
  ArrayType extends readonly (infer ElementType)[] ? ElementType : never;

function ChapterContent( {content}: { content: ChapterContent }) {
    if (content.type === 'heading') {
        return <h3>{content.content.join(' ')}</h3>
    } else if(content.type === 'line_break') {
        return <br></br>
    } else if (content.type === 'verse') {
        return <Verse verse={content}></Verse>
    }

    return <></>
}

function Verse({verse}: { verse: ChapterVerse}) {
    return <span> <em>{verse.number}</em> {verse.content.map(c => <VerseContent content={c}></VerseContent>)}</span>
}

function VerseContent({ content }: { content: ArrayElement<ChapterVerse['content']> }) {
    if (typeof content === 'string') {
        return <> {content}</>;
    } else if(typeof content === 'object') {
        if ('text' in content) {
            return <> {content.text}</>;
        } else if('noteId' in content) {
            return <></>;
        }
    }

    return <></>;
}

function ChapterTemplate({ pageContext }: PageProps<any, { chapter: TranslationBookChapter }>): any {
        const chapter: TranslationBookChapter = pageContext.chapter;
    return <Layout>
        <h1>{chapter.book.commonName} {chapter.chapter.number}</h1>
        {chapter.chapter.content.map(c => <ChapterContent content={c} />)}
    </Layout>
}

export default ChapterTemplate;