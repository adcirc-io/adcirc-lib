
function button ( text ) {

    var _selection;

    var _color = 'lightsteelblue';
    var _color_border = 'lightslategray';
    var _color_hover = 'steelblue';
    var _filepicker;
    var _filepicker_cb;
    var _text = text;

    function _button ( selection ) {

        _selection = selection
            .style( 'display', 'flex' )
            .style( 'min-width', '150px' )
            .style( 'min-height', '30px' )
            .style( 'justify-content', 'center' )
            .style( 'align-items', 'center' )
            .style( 'background-color', _color )
            .style( 'border', '1px solid ' + _color_border )
            .style( 'cursor', 'pointer' )
            .style( 'user-select', 'none' )
            .text( _text )
            .on( 'mouseover', function () {
                d3.select( this )
                    .style( 'color', 'white' )
                    .style( 'background-color', _color_hover );
            })
            .on( 'mouseleave', function () {
                d3.select( this )
                    .style( 'color', null )
                    .style( 'background-color', _color );
            });

        _button.file_picker( _filepicker_cb );

        return _button;

    }

    _button.color = function ( _ ) {

        console.log( text );
        if ( !arguments.length ) return _color;
        if ( arguments.length == 1 ) {
            _color = arguments[0];
            _color_hover = d3.color( _color ).brighter();
        }
        if ( arguments.length == 2 ) {
            _color = arguments[0];
            _color_hover = arguments[1];
        }
        return _button;
    };

    _button.file_picker = function ( _ ) {

        if ( !arguments.length ) return _filepicker;
        if ( typeof _ !== 'function' ) return _button;

        _filepicker_cb = _;

        if ( !_filepicker && _selection ) {

            _filepicker = _selection.append( 'input' )
                .attr( 'type', 'file' )
                .style( 'display', 'none' )
                .on( 'click', function () {
                    d3.event.stopPropagation();
                })
                .on( 'change', function () {
                    if ( typeof _filepicker_cb === 'function' ) {
                        _filepicker_cb( _filepicker.node().files[0] );
                    }
                });

        }

        if ( _selection ) {

            _selection.on( 'click', function () {

                d3.event.preventDefault();
                _filepicker.node().click();

            });

        }

        return _button;

    };

    return _button;

}