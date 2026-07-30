import { cosineSimilarity } from '../../utils/math.js';
import { getSkillDocs } from './index.js';
import { wordOverlapScore } from '../../utils/text.js';

function isUsableEmbedding(value) {
    return Array.isArray(value)
        && value.length > 0
        && value.every(component => Number.isFinite(component));
}

function stableRank(entries) {
    return entries.sort((left, right) => {
        const scoreDelta = right.similarity_score - left.similarity_score;
        return Number.isFinite(scoreDelta) && scoreDelta !== 0
            ? scoreDelta
            : left.doc_key.localeCompare(right.doc_key);
    });
}

export class SkillLibrary {
    constructor(agent,embedding_model) {
        this.agent = agent;
        this.embedding_model = embedding_model;
        this.skill_docs_embeddings = {};
        this.skill_docs = null;
        this.always_show_skills = ['skills.placeBlock', 'skills.wait', 'skills.breakBlockAt'];
        this.always_show_skills_docs = {};
        this.embeddingUnavailableNotified = false;
    }

    _disableEmbeddings() {
        this.embedding_model = null;
        this.skill_docs_embeddings = {};
        if (!this.embeddingUnavailableNotified) {
            console.warn('Gameplay skill embeddings are unavailable; using complete lexical skill-doc ranking.');
            this.embeddingUnavailableNotified = true;
        }
    }

    _refreshAlwaysShowDocs() {
        this.always_show_skills_docs = {};
        for (const skillName of this.always_show_skills) {
            this.always_show_skills_docs[skillName] = this.skill_docs?.find(doc => doc.includes(skillName));
        }
    }

    _rankLexical(message, docs) {
        return stableRank(docs.map(doc_key => ({
            doc_key,
            similarity_score: wordOverlapScore(message, doc_key),
        })));
    }

    async initSkillLibrary() {
        const skillDocs = getSkillDocs() || [];
        this.skill_docs = skillDocs;
        if (this.embedding_model) {
            const results = await Promise.allSettled(skillDocs.map(async doc => {
                const func_name_desc = doc.split('\n').slice(0, 2).join('');
                return { doc, embedding: await this.embedding_model.embed(func_name_desc) };
            }));
            const embeddings = {};
            let incomplete = results.length !== skillDocs.length;
            for (const result of results) {
                if (result.status !== 'fulfilled' || !isUsableEmbedding(result.value.embedding)) {
                    incomplete = true;
                    continue;
                }
                embeddings[result.value.doc] = result.value.embedding;
            }
            if (incomplete || Object.keys(embeddings).length !== skillDocs.length) {
                this._disableEmbeddings();
            } else {
                this.skill_docs_embeddings = embeddings;
            }
        }
        this._refreshAlwaysShowDocs();
    }

    async getAllSkillDocs() {
        return this.skill_docs;
    }

    async getRelevantSkillDocs(message, select_num) {
        if(!message) // use filler message if none is provided
            message = '(no message)';
        const numericSelectNum = Number(select_num);
        const selectAll = numericSelectNum === -1;
        const docs = this.skill_docs || getSkillDocs() || [];
        if (!this.skill_docs) {
            this.skill_docs = docs;
            this._refreshAlwaysShowDocs();
        }
        let skill_doc_similarities = [];

        if (selectAll) {
            skill_doc_similarities = docs
            .map(doc_key => ({
                doc_key,
                similarity_score: 0
            }));
        }
        else if (!this.embedding_model || Object.keys(this.skill_docs_embeddings).length === 0) {
            // Embeddings only improve ranking; an outage must not hide gameplay skills.
            skill_doc_similarities = this._rankLexical(message, docs);
        }
        else {
            try {
                const latest_message_embedding = await this.embedding_model.embed(message);
                if (!isUsableEmbedding(latest_message_embedding)) {
                    throw new Error('Embedding model returned an invalid vector.');
                }
                skill_doc_similarities = stableRank(docs.map(doc_key => ({
                    doc_key,
                    similarity_score: cosineSimilarity(latest_message_embedding, this.skill_docs_embeddings[doc_key]),
                })));
                if (skill_doc_similarities.some(entry => !Number.isFinite(entry.similarity_score))) {
                    throw new Error('Embedding similarity was invalid.');
                }
            } catch (error) {
                this._disableEmbeddings();
                skill_doc_similarities = this._rankLexical(message, docs);
            }
        }

        let length = skill_doc_similarities.length;
        select_num = selectAll
            ? length
            : Number.isFinite(numericSelectNum)
                ? Math.max(0, Math.floor(numericSelectNum))
                : 0;
        if (select_num > length) {
            select_num = length;
        }
        // Get initial docs from similarity scores
        let selected_docs = new Set(skill_doc_similarities.slice(0, select_num).map(doc => doc.doc_key));
        
        // Add always show docs
        Object.values(this.always_show_skills_docs).forEach(doc => {
            if (doc) {
                selected_docs.add(doc);
            }
        });
        
        let relevant_skill_docs = '#### RELEVANT CODE DOCS ###\nThe following functions are available to use:\n';
        relevant_skill_docs += Array.from(selected_docs).join('\n### ');

        console.log('Selected skill docs:', Array.from(selected_docs).map(doc => {
            const first_line_break = doc.indexOf('\n');
            return first_line_break > 0 ? doc.substring(0, first_line_break) : doc;
        }));
        return relevant_skill_docs;
    }
}
