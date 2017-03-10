
function slider () {

    var _selection;
    var _bar;

    var _bar_color = 'dimgray';
    var _color = 'lightgray';
    var _count = 100;
    var _current = 0;
    var _height = 20;
    var _on = [];

    function _slider ( selection ) {

        _selection = selection
            .style( 'position', 'relative' )
            .style( 'width', '100%' )
            .style( 'margin-top', '4px' )
            .style( 'margin-bottom', '4px' );

        _bar = _selection
            .selectAll( 'div' )
            .data( [ 'slider_bar' ] );

        _bar.exit()
            .remove();

        _bar = _bar.enter()
            .append( 'div' )
            .merge( _bar );

        _bar.style( 'position', 'relative' )
            .style( 'left', 0 )
            .style( 'width', '1px' )
            .style( 'background-clip', 'content-box' )
            .style( 'margin', '-4px' )
            .style( 'border-width', '4px' )
            .style( 'border-style', 'solid' )
            .style( 'cursor', 'pointer' );

        _slider.bar_color( _bar_color );
        _slider.color( _color );
        _slider.height( _height );
        
        return _slider;

    }

    _slider.bar_color = function ( _ ) {
        if ( !arguments.length ) return _bar_color;
        _bar_color = _;

        if ( _bar )
            _bar
                .style( 'background-color', _bar_color )
                .style( 'border-color', _bar_color + ' transparent ' + _bar_color + ' transparent' );

        return _slider;
    };

    _slider.color = function ( _ ) {
        if ( !arguments.length ) return _color;
        _color = _;
        if ( _selection ) _selection.style( 'background-color', _color );
        return _slider;
    };

    _slider.count = function ( _ ) {
        if ( !arguments.length ) return _count;
        if ( _ > 0 ) _count = _;
        if ( _current >= _count ) _current = _count - 1;
        return _slider.current( _current );
    };

    _slider.current = function ( _ ) {
        if ( !arguments.length ) return _current;
        if ( _ >= 0 && _ < _count ) {
            _current = _;
            if ( _bar ) _bar.style( 'left', 100 * _current / ( _count-1 ) + '%' );
        }
        return _slider;
    };

    _slider.height = function ( _ ) {
        if ( !arguments.length ) return _height;
        _height = _;
        if ( _selection ) _selection.style( 'min-height', _height + 'px' );
        if ( _bar ) _bar.style( 'min-height', _height + 'px' );
        return _slider;
    };

    _slider.on = function ( _ ) {

    };

    return _slider;

}