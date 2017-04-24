// Import the neccesary modules.
import asyncq from 'async-q';
import { ItemType } from 'butter-provider';

import FactoryProducer from '../resources/FactoryProducer';
import IProvider from './IProvider';

/**
 * Class for scraping content from various sources.
 * @implements {IProvider}
 */
export default class BaseProvider extends IProvider {

  /**
   * The types of models available for the API.
   * @type {Object}
   */
  static ModelTypes = {
    AnimeMovie: 'animemovie',
    AnimeShow: 'animeshow',
    Movie: 'movie',
    Show: 'show'
  }

  /**
   * The types of content available for the API.
   * @type {Object}
   */
  static Types = {
    Movie: ItemType.MOVIE,
    Show: ItemType.TVSHOW
  }

  /**
   * The maximum web requests can take place at the same time. Default is `2`.
   * @type {Number}
   */
  static MaxWebRequest = 2;

  /**
   * Create a BaseProvider class.
   * @param {Object} config - The configuration object for the torrent
   * provider.
   * @param {Object} config.api - The name of api for the torrent provider.
   * @param {String} config.name - The name of the torrent provider.
   * @param {String} config.modelType - The model type for the helper.
   * @param {Object} config.query - The query object for the api.
   * @param {Array<RegExp>} config.regexps - The regexps used to extract
   * information about movies.
   * @param {String} config.type - The type of content to scrape.
   */
  constructor({api, name, modelType, query, regexps, type} = {}) {
    super();

    const apiFactory = FactoryProducer.getFactory('api');
    const helperFactory = FactoryProducer.getFactory('helper');
    const modelFactory = FactoryProducer.getFactory('model');

    const model = modelFactory.getModel(modelType);

    /**
     * The api of the torrent provider.
     * @type {Object}
     */
    this._api = apiFactory.getApi(api);

    /**
     * The name of the torrent provider.
     * @type {String}
     */
    this._name = name;

    /**
     * The helper class for adding movies.
     * @type {BaseHelper}
     */
    this._helper = helperFactory.getHelper(this._name, model, type);

    /**
     * The query object for the api.
     * @type {Object}
     */
    this._query = query;

    /**
     * The regexps used to extract information about movies.
     * @type {Array<RegExp>}
     */
    this._regexps = regexps;

    /**
     * The type of content to scrape.
     * @type {String}
     */
    this._type = type;
  }

  /**
   * Get all the content.
   * @override
   * @param {Object} content - The content information.
   * @returns {Object} - A content object.
   */
  async getContent(content) {
    try {
      let newContent;

      if (this._type === BaseProvider.Types.Movie) {
        const { slugYear, torrents } = content;
        newContent = await this._helper.getTraktInfo(slugYear);

        if (newContent && newContent._id)
          return await this._helper.addTorrents(newContent, torrents);
      } else if (this._type === BaseProvider.Types.Show) {
        const { episodes, slug } = content;
        delete episodes[0];
        newContent = await this._helper.getTraktInfo(slug);

        if (newContent && newContent._id)
          return await this._helper.addEpisodes(newContent, episodes, slug);
      } else {
        throw new Error(`'${this._type}' is not a valid value for Types!`);
      }
    } catch (err) {
      logger.error(err);
    }
  }

  /**
   * Get movie info from a given torrent.
   * @override
   * @param {Object} torrent - A torrent object to extract movie information
   * from.
   * @param {String} [lang=en] - The language of the torrent.
   * @returns {Object} - Information about a movie from the torrent.
   */
  _getContentData(torrent, lang = 'en') {
    // FIXME: Fix datebased tv shows.
    const regex = this._regexps.find(
      regex => regex.test(torrent.title) ? regex : null
    );

    if (regex)
      return this._extractContent(torrent, regex, lang);

    logger.warn(
      `${this._name}: Could not find data from torrent: '${torrent.title}'`
    );
  }

  /**
   * Get all the torrents of a given torrent provider.
   * @override
   * @param {Number} totalPages - The total pages of the query.
   * @returns {Array<Object>} - A list of all the queried torrents.
   */
  _getAllTorrents(totalPages) {
    let torrents = [];
    return asyncq.timesSeries(totalPages, async page => {
      if (this._query.offset) this._query.offset = page + 1;

      logger.info(`${this._name}: Started searching ${this._name} on page ${page + 1} out of ${totalPages}`);
      let { results, data } = await this._api.search(this._query);
      results = results ? results : [];
      data = data ? data.movies : [];

      torrents = torrents.concat(results, data);
    }).then(() => {
      logger.info(`${this._name}: Found ${torrents.length} torrents.`);
      return torrents;
    });
  }

  /**
   * Returns a list of all the inserted torrents.
   * @override
   * @returns {Array<Object>} - A list of scraped content.
   */
  async search() {
    try {
      const getTotalPages = await this._api.search(this._query);

      let totalPages;
      if (process.env.NODE_ENV === 'development') {
        totalPages = 1;
      } else {
        totalPages = getTotalPages.total_pages
                              ? getTotalPages.total_pages
                              : Math.ceil(getTotalPages.data.movie_count / 50);
      }

      if (!totalPages)
        return logger.error(`${this._name}: totalPages returned: '${totalPages}'`);

      logger.info(`${this._name}: Total pages ${totalPages}`);

      const torrents = await this._getAllTorrents(totalPages);

      const { language } = this._query;
      const allContent = await this._getAllContent(torrents, language);

      return await asyncq.mapLimit(allContent, BaseProvider.MaxWebRequest,
        content => this.getContent(content)
      );
    } catch (err) {
      logger.error(err);
    }
  }

}
