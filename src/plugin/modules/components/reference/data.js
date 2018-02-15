define([
    'bluebird',
    'moment',
    'knockout-plus',
    'kb_service/utils',
    '../../lib/types',
    '../../lib/searchApi',
    'yaml!../../data/stopWords.yml'
], function (
    Promise,
    moment,
    ko,
    apiUtils,
    Types,
    SearchAPI,
    stopWordsDb
) {
    'use strict';

    function isStopWord(word) {
        if (stopWordsDb.warn.indexOf(word) >= 0) {
            return true;
        }
        if (stopWordsDb.ignore.indexOf(word) >= 0) {
            return true;
        }
        return false;
    }

    // For now, this fakes the search...
    function factory(params) {
        var maxSearchResults = params.maxSearchItems;

        var searchConfig = {
            // max number of search result items to hold in the buffer
            // before we start removing those out of view
            maxBufferSize: params.maxBufferSize || 100,
            // number of search items to fetch at one time.
            fetchSize: params.pageSize || 20,
        };

        function objectToViewModel(obj) {
            var typeId = Types.typeIt(obj);
            if (!typeId) {
                console.error('ERROR cannot type object', obj);
                throw new Error('Cannot type this object');
            }
            obj.type = typeId;
            var type = Types.getType(typeId);
            if (!type || !type.methods || !type.methods.detail) {
                console.error('!! type not found', type, obj.type, obj);
                throw new Error('Type not found');
            }
            var ref = type.methods.guidToReference(obj.guid);
            var detail = type.methods.detail(obj);
            var detailMap = detail.reduce(function (m, field) {
                m[field.id] = field;
                return m;
            }, {});

            var matches = Object.keys(obj.highlight).reduce(function (matches, field) {
                if (field === 'source_tags') {
                    console.warn('highlight field ' + field + ' ignored');
                    return matches;
                } 
                if (!type.searchKeysMap[field]) {
                    console.warn('highlight field ' + field + ' not found in type spec', obj);
                    return matches;
                }
                matches.push({
                    id: field,
                    label: type.searchKeysMap[field].label,
                    highlights: obj.highlight[field].map(function (highlight) {
                        return {
                            highlight: highlight
                        };
                    })
                });
                return matches;
            }, []);
           
            // Uncomment to re-enable highlights merging into details
            // detail.forEach(function (field) {
            //     if (matchMap[field.id]) {
            //         field.highlights = matchMap[field.id].highlights;
            //     }
            // });

            var vm = {
                type: {
                    id: obj.type,
                    label: type.label
                },
                matchClass: {
                    id: type.ui.class,
                    copyable: type.ui.copyable,
                    viewable: type.ui.viewable,
                    ref: ref
                },

                // Detail, type-specific
                detail: detail,

                url: window.location.origin + '#dataview/' + ref.workspaceId + '/' + ref.objectId + '/' + ref.version,

                // should be different per object type? E.g. narrative - nice name, others object name??
                // Generic fields
                name: obj.object_name,                
                date: new Date(obj.timestamp * 1000),
                scientificName: detailMap.scientificName ? detailMap.scientificName.value || '' : '',

                matches: matches,
                selected: ko.observable(),
                showMatches: ko.observable(false),
                showDetails: ko.observable(false),
                active: ko.observable(false)
            };
            return vm;
        }

        function search(query) {
            var searchApi = SearchAPI.make({
                runtime: params.runtime
            });
            console.log('search api query:', query);
            return Promise.all([
                searchApi.referenceObjectSearch({
                    query: query.terms.join(' '),
                    page: query.start || 0,
                    pageSize: searchConfig.fetchSize
                }),
                searchApi.typeSearch({
                    query: query.terms.join(' '),
                    withPrivateData: 0,
                    withPublicData: 1,
                    dataSource: 'referenceData'
                })
            ])
                .spread(function (objectResults, typeResults) {
                    console.log('search api results (object, type):', objectResults, typeResults);
                    var objects = objectResults.objects.map(function (object) {
                        return objectToViewModel(object);
                    });
                    var totalByType = Object.keys(typeResults.type_to_count).map(function (typeName) {
                        return {
                            id: typeName.toLowerCase(),
                            count: typeResults.type_to_count[typeName]
                        };
                    });
                    var totalSearchHits;
                    if (objectResults.total > maxSearchResults) {
                        totalSearchHits = maxSearchResults;
                    } else {
                        totalSearchHits = objectResults.total;
                    }
                    return {
                        items: objects,
                        first: query.start,
                        isTruncated: true,
                        summary: {
                            totalByType: totalByType,
                            totalSearchHits: totalSearchHits,
                            totalSearchSpace: objectResults.total,
                            isTruncated: (totalSearchHits < objectResults.total)
                        },
                        stats: {
                            objectSearch: objectResults.search_time,
                            typeSearch: typeResults.search_time
                        }
                    };
                });
        }

        return {
            search: search,
            isStopWord: isStopWord
        };
    }

    return {
        make: factory
    };
});